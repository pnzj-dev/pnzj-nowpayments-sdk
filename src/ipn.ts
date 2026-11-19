// IPN / webhook signature handling.
//
// NOWPayments signs webhook payloads with HMAC-SHA512 (hex) over the
// deep-sorted JSON stringification of the payload, using the merchant's
// IPN secret. Implemented with Web Crypto so it runs identically in
// Cloudflare Workers, Bun, Node and browsers.
//
// Source of truth: NOWPayments IPN docs + official SDK (src/ipn.js).

import { NowPaymentsError } from "./errors";
import type { Payment, Payout, WebhookEvent } from "./types";

/** Recursively sort object keys (arrays keep their order). */
export function sortObjectDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObjectDeep);
  if (value !== null && typeof value === "object" && value.constructor === Object) {
    const record = value as Record<string, unknown>;
    return Object.keys(record)
      .sort()
      .reduce<Record<string, unknown>>((result, key) => {
        result[key] = sortObjectDeep(record[key]);
        return result;
      }, {});
  }
  return value;
}

const encoder = new TextEncoder();

function hexEncode(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

function hexDecode(hex: string): Uint8Array | null {
  const normalized = hex.trim().toLowerCase();
  if (normalized.length % 2 !== 0 || !/^[0-9a-f]*$/.test(normalized)) return null;
  const bytes = new Uint8Array(normalized.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(normalized.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

async function hmacSha512Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret.trim()),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return hexEncode(new Uint8Array(signature));
}

/** Constant-time hex comparison (no timing signal). */
function timingSafeEqualHex(a: string, b: string): boolean {
  const bytesA = hexDecode(a);
  const bytesB = hexDecode(b);
  if (!bytesA || !bytesB || bytesA.length !== bytesB.length) return false;
  let diff = 0;
  for (let i = 0; i < bytesA.length; i++) {
    diff |= bytesA[i]! ^ bytesB[i]!;
  }
  return diff === 0;
}

/** Produce the HMAC-SHA512 hex signature NOWPayments would send for a payload. */
export async function createWebhookSignature(
  payload: Record<string, unknown>,
  secret: string,
): Promise<string> {
  if (!secret.trim()) {
    throw new NowPaymentsError({
      type: "CONFIGURATION",
      code: "MISSING_IPN_SECRET",
      message: "IPN secret is required to create a webhook signature.",
    });
  }
  return hmacSha512Hex(secret, JSON.stringify(sortObjectDeep(payload)));
}

/**
 * Verify a webhook signature (the `x-nowpayments-sig` header) against the
 * payload and IPN secret. Returns false on any mismatch.
 */
export async function verifyWebhookSignature(
  payload: Record<string, unknown>,
  signature: string,
  secret: string,
): Promise<boolean> {
  if (!signature || !secret.trim()) return false;
  try {
    const expected = await createWebhookSignature(payload, secret);
    return timingSafeEqualHex(expected, signature);
  } catch {
    return false;
  }
}

/** Normalize a raw webhook payload into a typed event. */
export function parseWebhook(payload: Record<string, unknown>): WebhookEvent {
  if ("payment_id" in payload || "payment_status" in payload) {
    return { type: "payment.status_changed", payment: payload as unknown as Payment, raw: payload };
  }
  if ("batch_withdrawal_id" in payload && ("status" in payload || "payout_status" in payload)) {
    return { type: "payout.status_changed", payout: payload as unknown as Payout, raw: payload };
  }
  return { type: "unknown", raw: payload };
}
