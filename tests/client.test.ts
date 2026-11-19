import { describe, expect, test } from "bun:test";
import { NowPaymentsClient, NowPaymentsError } from "../src/index";

function mockFetch(handler: (url: URL, init: RequestInit) => Response | Promise<Response>): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof URL ? input : new URL(String(input));
    return Promise.resolve(handler(url, init ?? {}));
  }) as typeof fetch;
}

describe("NowPaymentsClient", () => {
  test("sends x-api-key on payment calls and parses responses", async () => {
    const calls: Array<{ url: URL; init: RequestInit }> = [];
    const fetchImpl = mockFetch((url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ payment_id: 123, payment_status: "waiting" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const client = new NowPaymentsClient({ apiKey: "test-key", fetch: fetchImpl });
    const payment = await client.createPayment({
      price_amount: 10,
      price_currency: "usd",
      pay_currency: "btc",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url.pathname).toBe("/v1/payment");
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("test-key");
    expect(payment.payment_id).toBe(123);
  });

  test("raises NowPaymentsError with httpStatus on API errors", async () => {
    const fetchImpl = mockFetch(() =>
      new Response(JSON.stringify({ message: "Bad API key" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
    );
    const client = new NowPaymentsClient({ apiKey: "bad", fetch: fetchImpl });
    try {
      await client.getPaymentStatus(1);
      throw new Error("expected rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(NowPaymentsError);
      const e = error as NowPaymentsError;
      expect(e.httpStatus).toBe(401);
      expect(e.type).toBe("API");
      expect(e.message).toBe("Bad API key");
    }
  });

  test("throws MISSING_API_KEY when the key is absent", async () => {
    const client = new NowPaymentsClient({ fetch: mockFetch(() => new Response("{}")) });
    try {
      await client.createPayment({ price_amount: 1 });
      throw new Error("expected rejection");
    } catch (error) {
      expect((error as NowPaymentsError).code).toBe("MISSING_API_KEY");
    }
  });

  test("payout endpoints require a JWT", async () => {
    const client = new NowPaymentsClient({ apiKey: "k", fetch: mockFetch(() => new Response("{}")) });
    try {
      await client.createPayout({ withdrawals: [] });
      throw new Error("expected rejection");
    } catch (error) {
      expect((error as NowPaymentsError).code).toBe("MISSING_JWT");
    }
  });

  test("bearer requests attach the JWT", async () => {
    const calls: Array<RequestInit> = [];
    const fetchImpl = mockFetch((_url, init) => {
      calls.push(init);
      return new Response(JSON.stringify({ data: [], total: 0 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const client = new NowPaymentsClient({ apiKey: "k", jwtToken: "jwt-abc", fetch: fetchImpl });
    await client.listPayments();

    const headers = calls[0]!.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer jwt-abc");
  });

  test("getStatus does not require an API key", async () => {
    const client = new NowPaymentsClient({ fetch: mockFetch(() => new Response('{"status":"ok"}')) });
    await expect(client.getStatus()).resolves.toEqual({ status: "ok" });
  });

  test("getFullCurrencies hits /v1/full-currencies (not a query param)", async () => {
    const calls: Array<URL> = [];
    const fetchImpl = mockFetch((url) => {
      calls.push(url);
      return new Response(JSON.stringify({ currencies: [] }), { status: 200 });
    });
    const client = new NowPaymentsClient({ apiKey: "k", fetch: fetchImpl });
    await client.getFullCurrencies();
    expect(calls[0]!.pathname).toBe("/v1/full-currencies");
    expect(calls[0]!.search).toBe("");
  });

  test("getFixedRateCurrencies sends fixed_rate=true", async () => {
    const calls: Array<URL> = [];
    const fetchImpl = mockFetch((url) => {
      calls.push(url);
      return new Response(JSON.stringify({ currencies: [] }), { status: 200 });
    });
    const client = new NowPaymentsClient({ apiKey: "k", fetch: fetchImpl });
    await client.getFixedRateCurrencies();
    expect(calls[0]!.pathname).toBe("/v1/currencies");
    expect(calls[0]!.searchParams.get("fixed_rate")).toBe("true");
  });

  test("getMerchantCoins hits /v1/merchant/coins with x-api-key", async () => {
    const calls: Array<{ url: URL; headers: Record<string, string> }> = [];
    const fetchImpl = mockFetch((url, init) => {
      calls.push({ url, headers: (init.headers ?? {}) as Record<string, string> });
      return new Response(JSON.stringify(["btc"]), { status: 200 });
    });
    const client = new NowPaymentsClient({ apiKey: "k", fetch: fetchImpl });
    await client.getMerchantCoins();
    expect(calls[0]!.url.pathname).toBe("/v1/merchant/coins");
    expect(calls[0]!.headers["x-api-key"]).toBe("k");
  });

  test("cancelSubscription uses DELETE and Bearer", async () => {
    const calls: Array<{ url: URL; init: RequestInit }> = [];
    const fetchImpl = mockFetch((url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({}), { status: 200 });
    });
    const client = new NowPaymentsClient({ apiKey: "k", jwtToken: "jwt", fetch: fetchImpl });
    await client.cancelSubscription(42);
    expect(calls[0]!.url.pathname).toBe("/v1/subscriptions/42");
    expect(calls[0]!.init.method).toBe("DELETE");
  });

  test("updateSubscriptionPlan uses PATCH", async () => {
    const calls: Array<RequestInit> = [];
    const fetchImpl = mockFetch((_url, init) => {
      calls.push(init);
      return new Response(JSON.stringify({}), { status: 200 });
    });
    const client = new NowPaymentsClient({ apiKey: "k", jwtToken: "jwt", fetch: fetchImpl });
    await client.updateSubscriptionPlan(7, { plan_name: "x" });
    expect(calls[0]!.method).toBe("PATCH");
  });

  test("conversion endpoints use Bearer", async () => {
    const calls: Array<{ url: URL; headers: Record<string, string> }> = [];
    const fetchImpl = mockFetch((url, init) => {
      calls.push({ url, headers: (init.headers ?? {}) as Record<string, string> });
      return new Response(JSON.stringify({}), { status: 200 });
    });
    const client = new NowPaymentsClient({ apiKey: "k", jwtToken: "jwt", fetch: fetchImpl });
    await client.createConversion({ from_currency: "btc", to_currency: "usdttrc20", amount: 0.1 });
    expect(calls[0]!.url.pathname).toBe("/v1/conversion");
    expect(calls[0]!.headers.authorization).toBe("Bearer jwt");
    await client.getConversionStatus(5);
    expect(calls[1]!.url.pathname).toBe("/v1/conversion/5");
  });

  test("payout cancel endpoints hit the right paths", async () => {
    const calls: Array<URL> = [];
    const fetchImpl = mockFetch((url) => {
      calls.push(url);
      return new Response(JSON.stringify({}), { status: 200 });
    });
    const client = new NowPaymentsClient({ apiKey: "k", jwtToken: "jwt", fetch: fetchImpl });
    await client.cancelPayout(9);
    await client.cancelPayoutBatch(3);
    expect(calls[0]!.pathname).toBe("/v1/payout/9/cancel");
    expect(calls[1]!.pathname).toBe("/v1/payout/3/cancel-batch");
  });

  test("fiat payout catalogs are API-key only", async () => {
    const calls: Array<{ url: URL; headers: Record<string, string> }> = [];
    const fetchImpl = mockFetch((url, init) => {
      calls.push({ url, headers: (init.headers ?? {}) as Record<string, string> });
      return new Response(JSON.stringify([]), { status: 200 });
    });
    const client = new NowPaymentsClient({ apiKey: "k", fetch: fetchImpl });
    await client.getFiatPayoutProviders();
    expect(calls[0]!.url.pathname).toBe("/v1/fiat-payouts/providers");
    expect(calls[0]!.headers.authorization).toBeUndefined();
  });

  test("JWT auto-refresh when within skew of expiry (provider)", async () => {
    const now = 1_700_000_000_000;
    const nearExpiry = Math.floor((now + 10_000) / 1000); // 10s left, skew is 30s
    const freshExp = Math.floor((now + 3_600_000) / 1000);
    const fakeJwt = (exp: number) =>
      `${btoa(JSON.stringify({ alg: "HS256" })).replace(/=/g, "")}.${btoa(JSON.stringify({ exp })).replace(/=/g, "")}.sig`;

    let providerCalls = 0;
    const jwtProvider = () => {
      providerCalls += 1;
      return providerCalls === 1 ? fakeJwt(nearExpiry) : fakeJwt(freshExp);
    };

    const authHeaders: Array<string | undefined> = [];
    const fetchImpl = mockFetch((_url, init) => {
      authHeaders.push(((init.headers ?? {}) as Record<string, string>).authorization);
      return new Response(JSON.stringify({ data: [], total: 0 }), { status: 200 });
    });

    const client = new NowPaymentsClient({
      apiKey: "k",
      jwtToken: jwtProvider,
      jwtRefreshSkewMs: 30_000,
      fetch: fetchImpl,
    });
    await client.listPayments();

    // near-expiry token -> provider consulted again for a fresh one
    expect(providerCalls).toBe(2);
    expect(authHeaders[0]).toBe(`Bearer ${fakeJwt(freshExp)}`);
  });

  test("JWT refresh is deduped across concurrent bearer calls", async () => {
    let authCalls = 0;
    const fetchImpl = mockFetch((url, init) => {
      if (url.pathname === "/v1/auth") {
        authCalls += 1;
        return new Response(JSON.stringify({ token: "jwt" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ data: [], total: 0 }), { status: 200 });
    });
    const client = new NowPaymentsClient({
      apiKey: "k",
      email: "a@b.c",
      password: "pw",
      fetch: fetchImpl,
    });
    await Promise.all([client.listPayments(), client.listPayments()]);
    // both calls needed a JWT; only one /v1/auth request should have happened
    expect(authCalls).toBe(1);
  });

  test("authenticate stores the returned JWT", async () => {
    const fetchImpl = mockFetch(() =>
      new Response(JSON.stringify({ token: "jwt-new" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const client = new NowPaymentsClient({ apiKey: "k", fetch: fetchImpl });
    const token = await client.authenticate({ email: "a@b.c", password: "pw" });
    expect(token).toBe("jwt-new");
    const jwt = token as string;

    let authHeader = "";
    const fetch2 = mockFetch((_url, init) => {
      authHeader = ((init.headers as Record<string, string>) ?? {}).authorization ?? "";
      return new Response(JSON.stringify({ data: [], total: 0 }), { status: 200 });
    });
    const client2 = new NowPaymentsClient({ apiKey: "k", jwtToken: jwt, fetch: fetch2 });
    await client2.listPayments();
    expect(authHeader).toBe("Bearer jwt-new");
  });
});
