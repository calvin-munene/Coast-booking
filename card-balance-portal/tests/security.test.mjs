import assert from "node:assert/strict";
import test from "node:test";
import { generateAccessCode, generateDemoCardId, hashSecret, isDemoCardId, normalizeCardId, verifySecret } from "../lib/security.js";

test("generates synthetic card IDs and six-digit access codes", () => {
  const cardId = generateDemoCardId();
  assert.equal(isDemoCardId(cardId), true);
  assert.match(cardId, /^DEMO-/);
  assert.match(generateAccessCode(), /^\d{6}$/);
});

test("normalizes card IDs without accepting payment-card numbers", () => {
  assert.equal(normalizeCardId(" demo-abcd-2345-wxyz "), "DEMO-ABCD-2345-WXYZ");
  assert.equal(isDemoCardId("4242-4242-4242-4242"), false);
});

test("hashes and verifies access codes", async () => {
  const stored = await hashSecret("123456");
  assert.equal(await verifySecret("123456", stored.salt, stored.hash), true);
  assert.equal(await verifySecret("654321", stored.salt, stored.hash), false);
  assert.notEqual(stored.hash, "123456");
});
