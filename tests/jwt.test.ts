import { describe, expect, test } from "bun:test";
import { base64UrlDecode, getJwtExpiresAtMs } from "../src/jwt";

function fakeJwt(exp?: number): string {
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  const payload = btoa(JSON.stringify(exp === undefined ? {} : { exp }))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  return `${header}.${payload}.sig`;
}

describe("base64UrlDecode", () => {
  test("decodes base64url JSON", () => {
    const encoded = btoa('{"exp":123}').replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
    expect(JSON.parse(base64UrlDecode(encoded))).toEqual({ exp: 123 });
  });
});

describe("getJwtExpiresAtMs", () => {
  test("extracts exp in ms", () => {
    expect(getJwtExpiresAtMs(fakeJwt(1_700_000_000))).toBe(1_700_000_000 * 1000);
  });

  test("returns null for missing exp or non-JWT", () => {
    expect(getJwtExpiresAtMs(fakeJwt())).toBeNull();
    expect(getJwtExpiresAtMs("not-a-jwt")).toBeNull();
    expect(getJwtExpiresAtMs(null)).toBeNull();
  });
});
