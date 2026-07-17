import test from "node:test";
import assert from "node:assert/strict";
import { createMilestoneStore } from "../src/milestoneStore.js";

function result(rows = []) {
  return { rows, rowCount: rows.length };
}

test("voucher creation is request-idempotent and never persists the redeemable code", async () => {
  const vouchers = new Map();
  const inserts = [];
  const client = {
    async query(sql, params = []) {
      const statement = String(sql);
      if (statement.includes("pg_advisory_xact_lock")) return result();
      if (statement.includes("FROM credit_vouchers WHERE creation_request_id")) {
        const existing = vouchers.get(params[0]);
        return result(existing ? [existing] : []);
      }
      if (statement.includes("INSERT INTO credit_vouchers")) {
        inserts.push(params);
        vouchers.set(params[1], {
          voucher_id: params[0],
          display_prefix: params[3],
          credit_amount: params[4],
          maximum_redemptions: params[5],
          per_user_limit: params[6],
          valid_from: params[11],
          expires_at: params[12]
        });
        return result();
      }
      if (statement.includes("INSERT INTO audit_logs")) return result();
      throw new Error(`Unexpected query: ${statement.slice(0, 80)}`);
    }
  };
  const store = createMilestoneStore({
    transaction: (operation) => operation(client),
    ensureUserWithClient: async () => {}
  });
  const requestId = "8ea71f6d-1bb6-41d1-a593-011dfca8e551";
  const first = await store.createVoucher({ actorUserId: "6643462826", requestId, creditAmount: 25 });
  const duplicate = await store.createVoucher({ actorUserId: "6643462826", requestId, creditAmount: 25 });

  assert.equal(first.duplicate, false);
  assert.match(first.code, /^NVID-[A-Z2-9]{4}(?:-[A-Z2-9]{4}){3}$/);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.voucherId, first.voucherId);
  assert.equal(duplicate.code, null);
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0][1], requestId);
  assert.match(inserts[0][2], /^[a-f0-9]{64}$/);
  assert.equal(inserts[0].includes(first.code), false);
});
