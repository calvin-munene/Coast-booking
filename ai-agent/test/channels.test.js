import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { validMetaSignature } from "../src/channels.js";

test("validates Meta webhook signatures", () => {
  process.env.META_APP_SECRET = "test-secret";
  const body = Buffer.from('{"ok":true}');
  const signature = `sha256=${crypto.createHmac("sha256", "test-secret").update(body).digest("hex")}`;
  assert.equal(validMetaSignature(body, signature), true);
  assert.equal(validMetaSignature(body, "sha256=bad"), false);
});
