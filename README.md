# @pnzj-dev/nowpayments

Runtime-agnostic TypeScript SDK for the [NOWPayments](https://nowpayments.io) API —
payments, invoices, payouts, mass payouts, custodial subscriptions, and IPN
verification. Zero runtime dependencies; built on Web-platform APIs only
(`fetch`, `AbortController`, Web Crypto), so it runs identically in:

- **Cloudflare Workers** (incl. Pages Functions)
- **Bun**
- **Node.js ≥ 18**
- Browsers (subject to CORS on the NOWPayments side)

## Install

```sh
npm install @pnzj-dev/nowpayments
# or: bun add @pnzj-dev/nowpayments
```

## Quick start — one-off payment (Cloudflare Workers)

```ts
import { NowPaymentsClient } from "@pnzj-dev/nowpayments";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const np = new NowPaymentsClient({ apiKey: env.NOWPAYMENTS_API_KEY });

    const payment = await np.createPayment({
      price_amount: 29.9,
      price_currency: "usd",
      pay_currency: "btc",
      order_id: "order-123",
      ipn_callback_url: "https://api.example.com/webhooks/nowpayments",
    });

    return Response.json({
      address: payment.pay_address,
      amount: payment.pay_amount,
      currency: payment.pay_currency,
    });
  },
};
```

## Payments

| Method | Endpoint |
|---|---|
| `createPayment(input)` | `POST /v1/payment` |
| `createPaymentByInvoice(input)` | `POST /v1/invoice-payment` |
| `getPaymentStatus(id)` | `GET /v1/payment/:id` |
| `listPayments(query)` *(JWT)* | `GET /v1/payment/` |
| `updatePaymentEstimate(id)` | `POST /v1/payment/:id/update-merchant-estimate` |
| `getMinimumAmount(query)` | `GET /v1/min-amount` |
| `getEstimate(query)` | `GET /v1/estimate` |
| `getCurrencies(query)` / `getFullCurrencies()` | `GET /v1/currencies` |

## Invoices (hosted checkout)

```ts
const invoice = await np.createInvoice({
  price_amount: 49,
  price_currency: "usd",
  order_id: "checkout-42",
  success_url: "https://shop.example.com/success",
  cancel_url: "https://shop.example.com/cart",
});
// redirect the payer to invoice.invoice_url
```

## Payouts & mass payouts (JWT + 2FA)

Payout endpoints are Bearer-protected: authenticate with dashboard
email/password once, or set a JWT directly.

```ts
const np = new NowPaymentsClient({ apiKey: env.NOWPAYMENTS_API_KEY });
await np.authenticate({ email: env.NP_DASHBOARD_EMAIL, password: env.NP_DASHBOARD_PASSWORD });

const batch = await np.createPayout({
  withdrawals: [
    { address: "0xabc...", currency: "usdt", amount: 100 },
    { address: "bc1q...", currency: "btc", amount: 0.5 },
  ],
  ipn_callback_url: "https://api.example.com/webhooks/nowpayments-payouts",
});

// NOWPayments requires a 6-digit 2FA code to release a payout batch.
// Either provide it from an authenticator, or generate it from the account's
// base32 2FA secret:
const code = await np.generateTotpCode(env.NP_2FA_SECRET);
await np.verifyPayout(batch.batch_withdrawal_id, code);
```

## Subscriptions — custodial & non-custodial

- **Custodial** (NOWPayments custody accounts, partner flow): customers hold
  funds in NOWPayments custody; recurring charges move funds to your account.

```ts
// create the customer's custody account once
await np.createSubPartnerAccount({ id: "user-42" });

// charge recurringly from their balance
await np.createSubscription({
  customer_id: "user-42",
  price_amount: 9.9,
  price_currency: "usd",
  period: "monthly",
  plan_name: "Comics+ Monthly",
});

const status = await np.getSubscriptionStatus(subscriptionId);
```

- **Non-custodial** (default flow): funds go straight to your wallet; implement
  recurrence yourself — schedule `createPayment` on your cron (e.g. a Worker
  cron trigger) and use `getPaymentStatus` + webhooks to track each cycle.

## Webhooks (IPN)

NOWPayments signs webhook payloads with HMAC-SHA512 (hex) over the
deep-sorted JSON body. Verify with your IPN secret:

```ts
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const payload = await request.json();
    const signature = request.headers.get("x-nowpayments-sig") ?? "";

    if (!(await new NowPaymentsClient().verifyIpnSignature(payload, signature, env.NP_IPN_SECRET))) {
      return new Response("invalid signature", { status: 401 });
    }

    const event = new NowPaymentsClient().parseIpn(payload);
    if (event.type === "payment.status_changed" && event.payment.payment_status === "paid") {
      // fulfill the order
    }
    return new Response("ok");
  },
};
```

## Errors

All failures raise `NowPaymentsError` with a stable `code` and `type`
(`CONFIGURATION`, `VALIDATION`, `NETWORK`, `TIMEOUT`, `API`, `UNKNOWN`);
API errors carry `httpStatus` and the response `details`.

## Development

```sh
bun install
bun test          # unit tests (mocked fetch, deterministic)
bun run typecheck
bun run build     # emits dist/ (ESM + d.ts)
```

Publishing is CI-driven: push a `v*` tag and the workflow runs tests, builds
and publishes to npm (set an `NPM_TOKEN` secret on the repo).

## License

MIT — see [LICENSE](LICENSE).
