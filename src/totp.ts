// RFC 6238 TOTP generation via Web Crypto (HMAC-SHA1/256/512).
// NOWPayments payout verification codes are 6-digit TOTP codes based on the
// base32 2FA secret from the account's 2FA settings.

export type TotpAlgorithm = "sha1" | "sha256" | "sha512";

export interface TotpOptions {
  algorithm?: TotpAlgorithm;
  digits?: 6;
  period?: number;
  /** Unix time in milliseconds (defaults to Date.now()). */
  nowMs?: number;
}

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Decode an RFC 4648 base32 string (tolerates lowercase, spaces, padding). */
export function base32Decode(input: string): Uint8Array {
  const cleaned = input.toUpperCase().replace(/=+$/, "").replace(/[\s-]/g, "");
  if (!/^[A-Z2-7]*$/.test(cleaned)) {
    throw new Error("Invalid base32 secret: unexpected characters");
  }
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of cleaned) {
    value = (value << 5) | BASE32_ALPHABET.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >> bits) & 0xff);
    }
  }
  return new Uint8Array(bytes);
}

function toHashName(algorithm: TotpAlgorithm): "SHA-1" | "SHA-256" | "SHA-512" {
  switch (algorithm) {
    case "sha256":
      return "SHA-256";
    case "sha512":
      return "SHA-512";
    default:
      return "SHA-1";
  }
}

function dynamicTruncate(bytes: Uint8Array): number {
  const offset = bytes[bytes.length - 1]! & 0x0f;
  const binary =
    ((bytes[offset]! & 0x7f) << 24) |
    ((bytes[offset + 1]! & 0xff) << 16) |
    ((bytes[offset + 2]! & 0xff) << 8) |
    (bytes[offset + 3]! & 0xff);
  return binary;
}

/** Generate the current TOTP code for a base32 secret. */
export async function generateTotpCode(secret: string, options: TotpOptions = {}): Promise<string> {
  const { algorithm = "sha1", digits = 6, period = 30, nowMs = Date.now() } = options;
  if (digits < 6 || digits > 8) throw new Error("TOTP digits must be between 6 and 8");

  const keyBytes = base32Decode(secret);
  const counter = Math.floor(nowMs / 1000 / period);
  const counterBuffer = new ArrayBuffer(8);
  const counterView = new DataView(counterBuffer);
  counterView.setUint32(0, Math.floor(counter / 2 ** 32));
  counterView.setUint32(4, counter >>> 0);

  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes.buffer as ArrayBuffer,
    { name: "HMAC", hash: toHashName(algorithm) },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, counterBuffer);
  const truncated = dynamicTruncate(new Uint8Array(signature)) % 10 ** digits;
  return truncated.toString().padStart(digits, "0");
}
