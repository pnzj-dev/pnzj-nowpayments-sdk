// Web-safe JWT helpers (no node:crypto / Buffer — works in Workers, Bun, Node, browsers).

/** Base64url-decode a JWT segment into a UTF-8 string. */
export function base64UrlDecode(segment: string): string {
  const normalized = segment.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  if (typeof atob === "function") {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  // Fallback for environments without atob (rare).
  const bytes = new Uint8Array(
    [...padded].map((c) => {
      const idx = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".indexOf(c);
      if (idx < 0) return 0;
      return idx;
    }),
  );
  let out = "";
  for (let i = 0; i < bytes.length; i += 4) {
    const a = bytes[i]!;
    const b = bytes[i + 1] ?? 0;
    const c = bytes[i + 2] ?? 0;
    out += String.fromCharCode((a << 2) | (b >> 4));
    if (i + 2 < bytes.length) out += String.fromCharCode(((b & 15) << 4) | (c >> 2));
    if (i + 3 < bytes.length) out += String.fromCharCode(((c & 3) << 6) | (bytes[i + 3] ?? 0));
  }
  return out;
}

/** Unix-ms expiry of a JWT, or null when it has no exp claim / is not a JWT. */
export function getJwtExpiresAtMs(token: string | null | undefined): number | null {
  if (typeof token !== "string" || !token.includes(".")) return null;
  const parts = token.split(".");
  if (!parts[1]) return null;
  try {
    const payload = JSON.parse(base64UrlDecode(parts[1])) as { exp?: unknown };
    if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp)) return null;
    return payload.exp * 1000;
  } catch {
    return null;
  }
}
