import { describe, expect, test } from "bun:test";
import { base32Decode, generateTotpCode } from "../src/totp";

describe("base32Decode", () => {
  test("decodes RFC 4648 with padding and lowercase", () => {
    // "JBSWY3DP" -> "Hello"
    expect([...base32Decode("jbswy3dp")]).toEqual([0x48, 0x65, 0x6c, 0x6c, 0x6f]);
  });
});

describe("generateTotpCode", () => {
  test("produces 6-digit codes, stable for a fixed clock", async () => {
    const code = await generateTotpCode("JBSWY3DPEHPK3PXP", { nowMs: 1_700_000_000_000 });
    expect(code).toMatch(/^\d{6}$/);
    const again = await generateTotpCode("JBSWY3DPEHPK3PXP", { nowMs: 1_700_000_000_000 });
    expect(again).toBe(code);
  });

  test("changes across periods", async () => {
    const secret = "JBSWY3DPEHPK3PXP";
    const a = await generateTotpCode(secret, { nowMs: 0 });
    const b = await generateTotpCode(secret, { nowMs: 30_000 });
    expect(a).not.toBe(b);
  });
});
