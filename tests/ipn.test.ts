import { describe, expect, test } from "bun:test";
import {
  createWebhookSignature,
  parseWebhook,
  sortObjectDeep,
  verifyWebhookSignature,
} from "../src/ipn";

describe("sortObjectDeep", () => {
  test("sorts keys recursively, keeps arrays in order", () => {
    const input = { b: { d: 1, c: [2, { z: 3, a: 4 }] }, a: "x" };
    const output = sortObjectDeep(input) as Record<string, unknown>;
    expect(Object.keys(output)).toEqual(["a", "b"]);
    expect(Object.keys(output.b as object)).toEqual(["c", "d"]);
    expect(JSON.stringify(output)).toBe(JSON.stringify({ a: "x", b: { c: [2, { a: 4, z: 3 }], d: 1 } }));
  });
});

describe("webhook signatures", () => {
  test("create + verify round-trip (order-independent payload)", async () => {
    const secret = "ipn-secret-123";
    const payload = { payment_id: 42, payment_status: "paid", order_id: "abc" };
    const signature = await createWebhookSignature(payload, secret);

    const shuffled = { order_id: "abc", payment_status: "paid", payment_id: 42 };
    expect(await verifyWebhookSignature(shuffled, signature, secret)).toBe(true);
  });

  test("wrong secret or tampered payload fails", async () => {
    const secret = "ipn-secret-123";
    const payload = { payment_id: 42, payment_status: "paid" };
    const signature = await createWebhookSignature(payload, secret);

    expect(await verifyWebhookSignature(payload, signature, "other-secret")).toBe(false);
    expect(
      await verifyWebhookSignature({ ...payload, payment_status: "failed" }, signature, secret),
    ).toBe(false);
    expect(await verifyWebhookSignature(payload, "deadbeef", secret)).toBe(false);
    expect(await verifyWebhookSignature(payload, "", secret)).toBe(false);
  });

  test("signature is HMAC-SHA512 hex (known-vector length)", async () => {
    const signature = await createWebhookSignature({ a: 1 }, "secret");
    expect(signature).toMatch(/^[0-9a-f]{128}$/);
  });
});

describe("parseWebhook", () => {
  test("payment event", () => {
    const event = parseWebhook({ payment_id: 1, payment_status: "paid" });
    expect(event.type).toBe("payment.status_changed");
  });

  test("payout event", () => {
    const event = parseWebhook({ batch_withdrawal_id: 2, status: "finished" });
    expect(event.type).toBe("payout.status_changed");
  });

  test("unknown payload", () => {
    const event = parseWebhook({ something: "else" });
    expect(event.type).toBe("unknown");
  });
});
