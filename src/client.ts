// NowPaymentsClient — the main entry point.
// Endpoint map mirrors the official NOWPayments v1 API (verified against the
// official Node SDK's client implementation).

import { NowPaymentsError } from "./errors";
import { HttpClient } from "./http";
import type {
  Estimate,
  EstimateQuery,
  Invoice,
  InvoiceInput,
  InvoicePaymentInput,
  MinimumAmount,
  MinimumAmountQuery,
  NowPaymentsClientOptions,
  Payment,
  PaymentInput,
  PaymentsList,
  PaymentsListQuery,
  Payout,
  PayoutFeeQuery,
  PayoutInput,
  PayoutsList,
  PayoutsListQuery,
  SubPartnerAccountInput,
  Subscription,
  SubscriptionInput,
  WebhookEvent,
} from "./types";
import {
  createWebhookSignature,
  parseWebhook,
  verifyWebhookSignature,
} from "./ipn";
import { generateTotpCode } from "./totp";

const DEFAULT_BASE_URL = "https://api.nowpayments.io";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_USER_AGENT = "@pnzj-dev/nowpayments/0.1.0";

export interface AuthenticateInput {
  email: string;
  password: string;
}

export class NowPaymentsClient {
  readonly createWebhookSignature = createWebhookSignature;
  readonly verifyWebhookSignature = verifyWebhookSignature;
  readonly parseWebhook = parseWebhook;
  readonly generateTotpCode = generateTotpCode;

  private readonly http: HttpClient;
  private jwtToken: string | null = null;
  private jwtProvider: (() => string | null) | undefined;

  constructor(options: NowPaymentsClientOptions = {}) {
    if (typeof options.jwtToken === "function") {
      this.jwtProvider = options.jwtToken;
    } else if (options.jwtToken) {
      this.jwtToken = options.jwtToken;
    }

    this.http = new HttpClient({
      apiKey: options.apiKey,
      baseUrl: (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, ""),
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      fetchImpl: options.fetch ?? globalThis.fetch,
      userAgent: options.userAgent ?? DEFAULT_USER_AGENT,
      getJwtToken: () => this.jwtProvider?.() ?? this.jwtToken,
    });
  }

  /** Set (or clear) the dashboard JWT used for Bearer-protected endpoints. */
  setJwtToken(token: string | null): this {
    this.jwtToken = token;
    return this;
  }

  /** Exchange dashboard email/password for a JWT (POST /v1/auth). */
  async authenticate(credentials: AuthenticateInput): Promise<string | null> {
    const body = await this.http.request<{ token?: string }>({
      method: "POST",
      path: "/v1/auth",
      body: credentials,
      apiKey: false,
    });
    if (body.token) this.jwtToken = body.token;
    return body.token ?? null;
  }

  // ------------------------------------------------------------ core reads

  /** Service status (no auth). */
  getStatus(): Promise<unknown> {
    return this.http.request({ path: "/v1/status", apiKey: false });
  }

  /** Supported currencies. Pass { full: 1 } for extended metadata. */
  getCurrencies(query: Record<string, unknown> = {}): Promise<unknown> {
    return this.http.request({ path: "/v1/currencies", query });
  }

  /** Full currency metadata list. */
  getFullCurrencies(): Promise<unknown> {
    // The API rejects the historical `full=1` query; the plain endpoint already
    // returns the complete list with metadata.
    return this.http.request({ path: "/v1/currencies" });
  }

  /** Minimum payment amount for a currency pair. */
  getMinimumAmount(query: MinimumAmountQuery): Promise<MinimumAmount> {
    return this.http.request({ path: "/v1/min-amount", query: { ...query } });
  }

  /** Estimated conversion for an amount between two currencies. */
  getEstimate(query: EstimateQuery): Promise<Estimate> {
    return this.http.request({ path: "/v1/estimate", query: { ...query } });
  }

  // ------------------------------------------------------------ payments

  /** Create a direct crypto payment (POST /v1/payment). */
  createPayment(input: PaymentInput): Promise<Payment> {
    return this.http.request({ method: "POST", path: "/v1/payment", body: input });
  }

  /** Pay an existing invoice (POST /v1/invoice-payment). */
  createPaymentByInvoice(input: InvoicePaymentInput): Promise<Payment> {
    return this.http.request({ method: "POST", path: "/v1/invoice-payment", body: input });
  }

  /** Recalculate the fixed-rate estimate for an unpaid payment. */
  updatePaymentEstimate(paymentId: string | number): Promise<Payment> {
    return this.http.request({
      method: "POST",
      path: `/v1/payment/${encodeURIComponent(paymentId)}/update-merchant-estimate`,
    });
  }

  /** Payment status by id. */
  getPaymentStatus(paymentId: string | number): Promise<Payment> {
    return this.http.request({ path: `/v1/payment/${encodeURIComponent(paymentId)}` });
  }

  /** Paginated payments list (Bearer-protected). */
  listPayments(query: PaymentsListQuery = {}): Promise<PaymentsList> {
    return this.http.request({
      path: "/v1/payment/",
      query: { order_by: "desc", ...query },
      bearer: true,
    });
  }

  // ------------------------------------------------------------ invoices

  /** Create a hosted invoice with a redirect URL. */
  createInvoice(input: InvoiceInput): Promise<Invoice> {
    return this.http.request({ method: "POST", path: "/v1/invoice", body: input });
  }

  // ------------------------------------------------------------ payouts

  /** Custody balance (Bearer-protected). */
  getBalance(): Promise<unknown> {
    return this.http.request({ path: "/v1/balance", bearer: true });
  }

  /** Minimum payout amount for a currency (Bearer-protected). */
  getMinimumPayoutAmount(currency: string): Promise<unknown> {
    return this.http.request({
      path: `/v1/payout-withdrawal/min-amount/${encodeURIComponent(currency)}`,
      bearer: true,
    });
  }

  /** Network fee estimate for a payout (API key suffices). */
  getPayoutFee(query: PayoutFeeQuery): Promise<unknown> {
    return this.http.request({ path: "/v1/payout/fee", query: { ...query } });
  }

  /** Validate a payout destination address (Bearer-protected). */
  validatePayoutAddress(body: { address: string; currency: string }): Promise<unknown> {
    return this.http.request({ method: "POST", path: "/v1/payout/validate-address", body, bearer: true });
  }

  /** Create a payout batch (POST /v1/payout, Bearer-protected). */
  createPayout(input: PayoutInput): Promise<unknown> {
    return this.http.request({ method: "POST", path: "/v1/payout", body: input, bearer: true });
  }

  /** Verify a payout batch with the 6-digit 2FA code. */
  verifyPayout(batchId: string | number, verificationCode: string | number): Promise<unknown> {
    return this.http.request({
      method: "POST",
      path: `/v1/payout/${encodeURIComponent(batchId)}/verify`,
      body: { verification_code: String(verificationCode) },
      bearer: true,
    });
  }

  /** Payout status by id. */
  getPayoutStatus(payoutId: string | number): Promise<Payout> {
    return this.http.request({
      path: `/v1/payout/${encodeURIComponent(payoutId)}`,
      bearer: true,
    });
  }

  /** Paginated payouts list (Bearer-protected). */
  listPayouts(query: PayoutsListQuery = {}): Promise<PayoutsList> {
    return this.http.request({
      path: "/v1/payout",
      query: { order_by: "desc", ...query },
      bearer: true,
    });
  }

  // ------------------------------------------------------------ custody

  /** Create a custodial recurring subscription charged to a customer's balance. */
  createSubscription(input: SubscriptionInput): Promise<Subscription> {
    return this.http.request({ method: "POST", path: "/v1/subscriptions", body: input });
  }

  /** Custodial subscription status. */
  getSubscriptionStatus(subscriptionId: string | number): Promise<Subscription> {
    return this.http.request({
      path: `/v1/subscriptions/${encodeURIComponent(subscriptionId)}`,
    });
  }

  /** Create a customer custody account (partner flow). */
  createSubPartnerAccount(input: SubPartnerAccountInput): Promise<unknown> {
    return this.http.request({ method: "POST", path: "/v1/sub-partner/balance", body: input });
  }

  /** Customer custody balance. */
  getSubPartnerBalance(userId: string | number): Promise<unknown> {
    return this.http.request({
      path: `/v1/sub-partner/balance/${encodeURIComponent(userId)}`,
    });
  }

  /** List customer custody accounts. */
  listSubPartners(query: Record<string, unknown> = {}): Promise<unknown> {
    return this.http.request({ path: "/v1/sub-partner", query });
  }

  /** List transfers between customer accounts. */
  listSubPartnerTransfers(query: Record<string, unknown> = {}): Promise<unknown> {
    return this.http.request({ path: "/v1/sub-partner/transfers", query });
  }

  /** Single transfer details. */
  getSubPartnerTransfer(transferId: string | number): Promise<unknown> {
    return this.http.request({
      path: `/v1/sub-partner/transfer/${encodeURIComponent(transferId)}`,
    });
  }

  /** Move funds to a customer account (partner payment). */
  subPartnerPayment(body: Record<string, unknown>): Promise<unknown> {
    return this.http.request({ method: "POST", path: "/v1/sub-partner/payment", body });
  }

  /** Deposit funds from a customer account. */
  subPartnerDeposit(body: Record<string, unknown>): Promise<unknown> {
    return this.http.request({ method: "POST", path: "/v1/sub-partner/deposit", body });
  }

  /** Withdraw funds from a customer account to the master account. */
  subPartnerWriteOff(body: Record<string, unknown>): Promise<unknown> {
    return this.http.request({ method: "POST", path: "/v1/sub-partner/write-off", body });
  }

  // ------------------------------------------------------------ webhooks

  /** Verify a webhook payload against its x-nowpayments-sig header. */
  verifyIpnSignature(
    payload: Record<string, unknown>,
    signature: string,
    secret?: string,
  ): Promise<boolean> {
    const resolved = secret ?? "";
    if (!resolved) {
      return Promise.reject(
        new NowPaymentsError({
          type: "CONFIGURATION",
          code: "MISSING_IPN_SECRET",
          message: "IPN secret is required — pass it to the client constructor or to this method.",
        }),
      );
    }
    return verifyWebhookSignature(payload, signature, resolved);
  }

  /** Normalize a webhook payload into a typed event. */
  parseIpn(payload: Record<string, unknown>): WebhookEvent {
    return parseWebhook(payload);
  }
}
