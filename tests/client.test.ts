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
