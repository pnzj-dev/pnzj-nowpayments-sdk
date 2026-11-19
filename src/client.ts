// NowPaymentsClient — the main entry point.
// Endpoint map mirrors the official NOWPayments v1 API (verified against the
// official Node SDK's client implementation).

import { NowPaymentsError } from "./errors";
import { HttpClient } from "./http";
import { getJwtExpiresAtMs } from "./jwt";
import type {
  ConversionInput,
  Estimate,
  EstimateQuery,
  FiatPayoutAccountInput,
  FiatPayoutInput,
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
  SubscriptionPlanInput,
  SubscriptionsListQuery,
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
const DEFAULT_USER_AGENT = "@pnzj-dev/nowpayments/0.1.5";
const DEFAULT_JWT_REFRESH_SKEW_MS = 30_000;

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
  private readonly jwtRefreshSkewMs: number;
  private jwtToken: string | null = null;
  private jwtProvider: (() => string | null) | undefined;
  private credentials: { email: string; password: string } | null = null;
  private refreshInFlight: Promise<string | null> | null = null;

  constructor(options: NowPaymentsClientOptions = {}) {
    if (typeof options.jwtToken === "function") {
      this.jwtProvider = options.jwtToken;
    } else if (options.jwtToken) {
      this.jwtToken = options.jwtToken;
    }
    if (options.email && options.password) {
      this.credentials = { email: options.email, password: options.password };
    }

    this.jwtRefreshSkewMs = options.jwtRefreshSkewMs ?? DEFAULT_JWT_REFRESH_SKEW_MS;

    this.http = new HttpClient({
      apiKey: options.apiKey,
      baseUrl: (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, ""),
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      fetchImpl: options.fetch ?? globalThis.fetch,
      userAgent: options.userAgent ?? DEFAULT_USER_AGENT,
      getJwtToken: () => this.ensureJwt(),
    });
  }

  /** Set (or clear) the dashboard JWT used for Bearer-protected endpoints. */
  setJwtToken(token: string | null): this {
    this.jwtToken = token;
    return this;
  }

  /** True when the current JWT is expired (or expires within the refresh skew). */
  isJwtTokenExpired(nowMs: number = Date.now()): boolean {
    const token = this.jwtProvider ? this.jwtProvider() : this.jwtToken;
    const expiresAt = getJwtExpiresAtMs(token);
    if (expiresAt === null) return false;
    return expiresAt <= nowMs + this.jwtRefreshSkewMs;
  }

  /** Exchange dashboard email/password for a JWT (POST /v1/auth). */
  async authenticate(credentials: AuthenticateInput): Promise<string | null> {
    this.credentials = credentials;
    const body = await this.http.request<{ token?: string }>({
      method: "POST",
      path: "/v1/auth",
      body: credentials,
      apiKey: false,
    });
    if (body.token) this.jwtToken = body.token;
    return body.token ?? null;
  }

  /** Force a fresh JWT using the stored credentials (or the provider token). */
  async refreshJwtToken(): Promise<string | null> {
    if (this.refreshInFlight) return this.refreshInFlight;
    if (this.credentials) {
      this.refreshInFlight = this.authenticate(this.credentials).finally(() => {
        this.refreshInFlight = null;
      });
      return this.refreshInFlight;
    }
    if (this.jwtProvider) {
      const token = this.jwtProvider();
      if (token) this.jwtToken = token;
      return this.jwtToken;
    }
    return this.jwtToken;
  }

  /**
   * Return a usable JWT for Bearer endpoints: the current token, refreshed
   * first when it is expired or within the refresh skew of expiring.
   * Returns null when no credentials are configured.
   */
  async ensureJwt(): Promise<string | null> {
    if (this.jwtProvider) {
      const token = this.jwtProvider();
      const expiresAt = getJwtExpiresAtMs(token);
      if (token && (expiresAt === null || expiresAt > Date.now() + this.jwtRefreshSkewMs)) {
        return token;
      }
      return this.refreshJwtToken();
    }
    if (!this.jwtToken) {
      if (this.credentials) return this.refreshJwtToken();
      return null;
    }
    if (this.isJwtTokenExpired()) return this.refreshJwtToken();
    return this.jwtToken;
  }

  // ------------------------------------------------------------ core reads

  /** Service status (no auth). */
  getStatus(): Promise<unknown> {
    return this.http.request({ path: "/v1/status", apiKey: false });
  }

  /** Supported currencies. */
  getCurrencies(query: Record<string, unknown> = {}): Promise<unknown> {
    return this.http.request({ path: "/v1/currencies", query });
  }

  /** Full currency metadata list (GET /v1/full-currencies). */
  getFullCurrencies(): Promise<unknown> {
    return this.http.request({ path: "/v1/full-currencies" });
  }

  /** Enabled/available currencies (alias of getCurrencies). */
  getAvailableCurrencies(query: Record<string, unknown> = {}): Promise<unknown> {
    return this.getCurrencies(query);
  }

  /** Currencies available with fixed-rate pricing (GET /v1/currencies?fixed_rate=true). */
  getFixedRateCurrencies(): Promise<unknown> {
    return this.http.request({ path: "/v1/currencies", query: { fixed_rate: true } });
  }

  /** Merchant-checked coins (GET /v1/merchant/coins). */
  getMerchantCoins(): Promise<unknown> {
    return this.http.request({ path: "/v1/merchant/coins" });
  }

  /** Alias of getMerchantCoins. */
  getMerchantCurrencies(): Promise<unknown> {
    return this.getMerchantCoins();
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

  /** Paginated payments list (Bearer-protected). Query params are passed through. */
  listPayments(query: PaymentsListQuery = {}): Promise<PaymentsList> {
    return this.http.request({
      path: "/v1/payment/",
      query: { ...query },
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

  /** Paginated payouts list (Bearer-protected). Query params are passed through
   * (e.g. order_by: "dateCreated", order: "desc"). */
  listPayouts(query: PayoutsListQuery = {}): Promise<PayoutsList> {
    return this.http.request({
      path: "/v1/payout",
      query: { ...query },
      bearer: true,
    });
  }

  /** Cancel a scheduled/recurring payout (POST /v1/payout/:payout_id/cancel). */
  cancelPayout(payoutId: string | number): Promise<unknown> {
    return this.http.request({
      method: "POST",
      path: `/v1/payout/${encodeURIComponent(payoutId)}/cancel`,
      bearer: true,
    });
  }

  /** Cancel a scheduled/recurring payout batch (POST /v1/payout/:batch_id/cancel-batch). */
  cancelPayoutBatch(batchId: string | number): Promise<unknown> {
    return this.http.request({
      method: "POST",
      path: `/v1/payout/${encodeURIComponent(batchId)}/cancel-batch`,
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

  /** Paginated custodial subscriptions (GET /v1/subscriptions). */
  listSubscriptions(query: SubscriptionsListQuery = {}): Promise<unknown> {
    return this.http.request({ path: "/v1/subscriptions", query: { ...query } });
  }

  /** Delete/cancel a recurring payment (DELETE /v1/subscriptions/:sub_id). */
  cancelSubscription(subscriptionId: string | number): Promise<unknown> {
    return this.http.request({
      method: "DELETE",
      path: `/v1/subscriptions/${encodeURIComponent(subscriptionId)}`,
    });
  }

  // ------------------------------------------------ subscription plans

  /** Create a subscription plan (POST /v1/subscriptions/plans). */
  createSubscriptionPlan(input: SubscriptionPlanInput): Promise<unknown> {
    return this.http.request({
      method: "POST",
      path: "/v1/subscriptions/plans",
      body: input,
      bearer: true,
    });
  }

  /** Update a subscription plan (PATCH /v1/subscriptions/plans/:plan_id). */
  updateSubscriptionPlan(planId: string | number, input: SubscriptionPlanInput): Promise<unknown> {
    return this.http.request({
      method: "PATCH",
      path: `/v1/subscriptions/plans/${encodeURIComponent(planId)}`,
      body: input,
      bearer: true,
    });
  }

  /** Get one subscription plan. */
  getSubscriptionPlan(planId: string | number): Promise<unknown> {
    return this.http.request({
      path: `/v1/subscriptions/plans/${encodeURIComponent(planId)}`,
      bearer: true,
    });
  }

  /** Paginated subscription plans. */
  listSubscriptionPlans(query: Record<string, unknown> = {}): Promise<unknown> {
    return this.http.request({ path: "/v1/subscriptions/plans", query: { ...query }, bearer: true });
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

  /** Create a transfer between customer accounts (POST /v1/sub-partner/transfer). */
  createSubPartnerTransfer(body: Record<string, unknown>): Promise<unknown> {
    return this.http.request({ method: "POST", path: "/v1/sub-partner/transfer", body, bearer: true });
  }

  /** Customer deposit payments (GET /v1/sub-partner/payments). */
  listSubPartnerPayments(query: Record<string, unknown> = {}): Promise<unknown> {
    return this.http.request({ path: "/v1/sub-partner/payments", query: { ...query }, bearer: true });
  }

  // ---------------------------------------------------------------- conversions

  /** Create a custody conversion (POST /v1/conversion, Bearer-protected). */
  createConversion(input: ConversionInput): Promise<unknown> {
    return this.http.request({ method: "POST", path: "/v1/conversion", body: input, bearer: true });
  }

  /** Conversion status (GET /v1/conversion/:conversion_id). */
  getConversionStatus(conversionId: string | number): Promise<unknown> {
    return this.http.request({
      path: `/v1/conversion/${encodeURIComponent(conversionId)}`,
      bearer: true,
    });
  }

  /** Paginated conversions list. */
  listConversions(query: Record<string, unknown> = {}): Promise<unknown> {
    return this.http.request({ path: "/v1/conversion", query: { ...query }, bearer: true });
  }

  // ---------------------------------------------------------------- fiat payouts

  /** Available fiat-payout providers (Bearer-protected). */
  getFiatPayoutProviders(): Promise<unknown> {
    return this.http.request({ path: "/v1/fiat-payouts/providers", bearer: true });
  }

  /** Available fiat currencies (Bearer-protected). */
  getFiatCurrencies(): Promise<unknown> {
    return this.http.request({ path: "/v1/fiat-payouts/fiat-currencies", bearer: true });
  }

  /** Crypto currencies available for fiat payouts (Bearer-protected). */
  getFiatCryptoCurrencies(query: Record<string, unknown> = {}): Promise<unknown> {
    return this.http.request({
      path: "/v1/fiat-payouts/crypto-currencies",
      query: { ...query },
      bearer: true,
    });
  }

  /** Payment methods for fiat payouts (Bearer-protected). */
  getFiatPaymentMethods(query: Record<string, unknown> = {}): Promise<unknown> {
    return this.http.request({
      path: "/v1/fiat-payouts/payment-methods",
      query: { ...query },
      bearer: true,
    });
  }

  /** Create a fiat-payout account (Bearer-protected). */
  createFiatPayoutAccount(input: FiatPayoutAccountInput): Promise<unknown> {
    return this.http.request({
      method: "POST",
      path: "/v1/fiat-payouts/account",
      body: input,
      bearer: true,
    });
  }

  /** Paginated fiat-payout accounts (Bearer-protected). */
  listFiatPayoutAccounts(query: Record<string, unknown> = {}): Promise<unknown> {
    return this.http.request({ path: "/v1/fiat-payouts/accounts", query: { ...query }, bearer: true });
  }

  /** Request a fiat payout (POST /v1/fiat-payouts, Bearer-protected). */
  createFiatPayout(input: FiatPayoutInput): Promise<unknown> {
    return this.http.request({ method: "POST", path: "/v1/fiat-payouts", body: input, bearer: true });
  }

  /** Paginated fiat payouts (Bearer-protected). */
  listFiatPayouts(query: Record<string, unknown> = {}): Promise<unknown> {
    return this.http.request({ path: "/v1/fiat-payouts", query: { ...query }, bearer: true });
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
