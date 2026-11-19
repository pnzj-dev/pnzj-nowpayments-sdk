// Request/response types for the NOWPayments v1 API. Snake-case fields mirror
// the wire format; camelCase aliases are provided on the main interfaces.

export type PaymentStatus =
  | "pending"
  | "processing"
  | "paid"
  | "partially_paid"
  | "failed"
  | "refunded"
  | "expired"
  | "cancelled"
  | "unknown";

export type PayoutStatus =
  | "pending"
  | "processing"
  | "sending"
  | "finished"
  | "failed"
  | "rejected"
  | "cancelled"
  | "unknown";

// ---------------------------------------------------------------- options

export interface NowPaymentsClientOptions {
  /** NOWPayments API key (x-api-key header). */
  apiKey?: string;
  /** IPN secret used to verify webhook signatures. */
  ipnSecret?: string;
  /** Dashboard JWT for Bearer-protected endpoints (payouts). */
  jwtToken?: string | (() => string | null);
  /** API base URL override (defaults to https://api.nowpayments.io). */
  baseUrl?: string;
  /** Per-request timeout in milliseconds (default 30000). */
  timeoutMs?: number;
  /** Custom fetch implementation (useful for tests / runtimes without fetch). */
  fetch?: typeof fetch;
  /** User-Agent header value. */
  userAgent?: string;
}

// ---------------------------------------------------------------- payments

export interface PaymentInput {
  price_amount?: number;
  price_currency?: string;
  pay_currency?: string;
  pay_amount?: number;
  ipn_callback_url?: string;
  order_id?: string;
  order_description?: string;
  purchase_id?: string;
  payout_address?: string;
  payout_extra_id?: string | null;
  payout_currency?: string;
  is_fixed_rate?: boolean;
  is_fee_paid_by_user?: boolean;
  /** Hosted-checkout flags (turn a payment into a redirect flow). */
  success_url?: string;
  cancel_url?: string;
  partially_paid_url?: string;
  case?: string;
  customer_email?: string;
  /** Client IP forwarded to NOWPayments (fraud controls). */
  origin_ip?: string;
}

export interface Payment {
  payment_id: number | null;
  invoice_id: string | null;
  payment_status: PaymentStatus | string;
  pay_address: string | null;
  payin_extra_id: string | null;
  price_amount: number | null;
  price_currency: string | null;
  pay_amount: number | null;
  actually_paid: number | null;
  actually_paid_at_fiat: number | null;
  pay_currency: string | null;
  order_id: string | null;
  order_description: string | null;
  purchase_id: string | null;
  outcome_amount: number | null;
  outcome_currency: string | null;
  ipn_callback_url: string | null;
  created_at: string | null;
  updated_at: string | null;
  valid_until: string | null;
  expiration_estimate_date: string | null;
  amount_received: number | null;
  network: string | null;
  network_precision: number | null;
  type: string | null;
  parent_payment_id: string | null;
  payment_extra_ids: Array<string | null> | null;
  [key: string]: unknown;
}

export interface PaymentsList {
  limit: number;
  page: number;
  pagesCount: number;
  total: number;
  data: Payment[];
}

export interface PaymentsListQuery {
  limit?: number;
  page?: number;
  sort_by?: "created_at" | "updated_at" | "price_amount" | string;
  order_by?: "asc" | "desc";
  date_from?: string;
  date_to?: string;
  [key: string]: unknown;
}

export interface MinimumAmountQuery {
  currency_from?: string;
  currency_to?: string;
  is_fixed_rate?: boolean;
  is_fee_paid_by_user?: boolean;
  fiat_equivalent?: number;
}

export interface MinimumAmount {
  currency_from: string | null;
  currency_to: string | null;
  min_amount: number | null;
  fiat_equivalent: number | null;
}

export interface EstimateQuery {
  amount: number;
  currency_from?: string;
  currency_to?: string;
}

export interface Estimate {
  currency_from: string | null;
  amount_from: number | null;
  currency_to: string | null;
  estimated_amount: number | null;
}

// ---------------------------------------------------------------- invoices

export interface InvoiceInput {
  price_amount: number;
  price_currency: string;
  pay_currency?: string;
  ipn_callback_url?: string;
  order_id?: string;
  order_description?: string;
  success_url?: string;
  cancel_url?: string;
  partially_paid_url?: string;
  payout_currency?: string;
  is_fixed_rate?: boolean;
  is_fee_paid_by_user?: boolean;
}

export interface Invoice {
  id: number | null;
  token_id: string | null;
  order_id: string | null;
  order_description: string | null;
  price_amount: number | null;
  price_currency: string | null;
  pay_currency: string | null;
  ipn_callback_url: string | null;
  invoice_url: string | null;
  success_url: string | null;
  cancel_url: string | null;
  partially_paid_url: string | null;
  payout_currency: string | null;
  created_at: string | null;
  updated_at: string | null;
  is_fixed_rate: boolean | null;
  is_fee_paid_by_user: boolean | null;
}

export interface InvoicePaymentInput {
  invoice_id?: string;
  iid?: string;
  pay_currency?: string;
  purchase_id?: string;
  order_description?: string;
  customer_email?: string;
  payout_address?: string;
  payout_extra_id?: string | null;
  payout_currency?: string;
}

// ---------------------------------------------------------------- payouts

export interface PayoutInput {
  /** Payouts are batched: withdrawals is an array of { address, currency, amount, extra_id? }. */
  withdrawals: Array<{
    address: string;
    currency: string;
    amount: number;
    extra_id?: string;
  }>;
  ipn_callback_url?: string;
  description?: string;
  network_fee_paid_by?: "sender" | "recipient" | "receiver";
}

export interface Payout {
  id: number | null;
  batch_withdrawal_id: number | null;
  status: PayoutStatus | string;
  address: string | null;
  currency: string | null;
  amount: number | null;
  fee: number | null;
  created_at: string | null;
  updated_at: string | null;
  [key: string]: unknown;
}

export interface PayoutsList {
  limit: number;
  page: number;
  pagesCount: number;
  total: number;
  data: Payout[];
}

export interface PayoutsListQuery {
  limit?: number;
  page?: number;
  sort_by?: string;
  order_by?: "asc" | "desc";
  date_from?: string;
  date_to?: string;
  [key: string]: unknown;
}

export interface PayoutFeeQuery {
  amount: number;
  currency: string;
  address?: string;
  network_fee_paid_by?: "sender" | "recipient" | "receiver";
}

// ---------------------------------------------------------------- custody

/** Custodial (recurring) subscription charged against a customer's custody balance. */
export interface SubscriptionInput {
  /** Customer's sub-partner user id (custody account). */
  customer_id: string;
  /** Recurring charge amount. */
  price_amount: number;
  /** Billing currency (e.g. "usd"). */
  price_currency: string;
  /** Payout/collection currency (e.g. "btc"). */
  pay_currency?: string;
  /** Plan identifier. */
  plan_id?: string;
  /** Plan name shown to the customer. */
  plan_name?: string;
  /** Charge period: "daily" | "weekly" | "monthly" | "yearly" or an interval. */
  period?: string;
  /** Billing start timestamp (ISO). */
  starts_at?: string;
  [key: string]: unknown;
}

export interface Subscription {
  id: string | null;
  subscription_id: string | null;
  status: string | null;
  [key: string]: unknown;
}

export interface SubPartnerAccountInput {
  /** Partner-assigned id for the customer. */
  id: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------- webhooks

export type WebhookEvent =
  | { type: "payment.status_changed"; payment: Payment; raw: Record<string, unknown> }
  | { type: "payout.status_changed"; payout: Payout; raw: Record<string, unknown> }
  | { type: "unknown"; raw: Record<string, unknown> };
