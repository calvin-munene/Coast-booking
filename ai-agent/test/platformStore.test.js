import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createPlatformStore, sourceIdentifierHash } from "../src/platformStore.js";

function platformPool() {
  const audit = new Map();
  const features = new Map([
    ["group_management", {
      feature_key: "group_management",
      enabled: false,
      description: "Group management",
      config: {},
      updated_by: null,
      updated_at: new Date()
    }]
  ]);
  const calls = [];
  const client = {
    async query(sql, values = []) {
      const text = String(sql);
      calls.push({ text, values });
      if (text.includes("SELECT version, checksum FROM app_schema_migrations")) return { rows: [], rowCount: 0 };
      if (text.includes("INSERT INTO platform_users") && text.includes("RETURNING user_id::text")) {
        return { rows: [{ user_id: String(values[0]), role: "standard_user" }], rowCount: 1 };
      }
      if (text.includes("SELECT action, target_id, metadata FROM audit_logs")) {
        const row = audit.get(values[0]);
        return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
      }
      if (text.includes("UPDATE feature_flags SET enabled")) {
        const row = features.get(values[0]);
        if (!row) return { rows: [], rowCount: 0 };
        Object.assign(row, { enabled: values[1], updated_by: String(values[2]), updated_at: new Date() });
        return { rows: [{ ...row }], rowCount: 1 };
      }
      if (text.includes("INSERT INTO audit_logs") && text.includes("feature_flag.updated")) {
        audit.set(values[0], {
          action: "feature_flag.updated",
          target_id: values[2],
          metadata: JSON.parse(values[3])
        });
        return { rows: [], rowCount: 1 };
      }
      if (text.includes("FROM feature_flags WHERE feature_key")) {
        const row = features.get(values[0]);
        return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
      }
      return { rows: [], rowCount: 0 };
    },
    release() { calls.push({ text: "RELEASE", values: [] }); }
  };
  return { calls, pool: { async connect() { return client; } } };
}

test("feature mutations are transactional, audited, and replay safe", async () => {
  const fake = platformPool();
  const store = createPlatformStore({ pool: fake.pool });
  const requestId = crypto.randomUUID();
  const first = await store.setFeatureFlag({
    actorUserId: "42",
    featureKey: "group_management",
    enabled: true,
    requestId
  });
  assert.equal(first.duplicate, false);
  assert.equal(first.feature.enabled, true);
  assert.ok(fake.calls.some(({ text }) => text.includes("INSERT INTO audit_logs")));

  const replay = await store.setFeatureFlag({
    actorUserId: "42",
    featureKey: "group_management",
    enabled: true,
    requestId
  });
  assert.equal(replay.duplicate, true);

  await assert.rejects(
    store.setFeatureFlag({ actorUserId: "42", featureKey: "group_management", enabled: false, requestId }),
    (error) => error.statusCode === 409
  );
  assert.ok(fake.calls.some(({ text }) => text === "ROLLBACK"));
});

test("security source identifiers use a keyed one-way digest", () => {
  const first = sourceIdentifierHash("203.0.113.10", { TELEGRAM_WEBHOOK_SECRET: "test-secret-a" });
  const repeated = sourceIdentifierHash("203.0.113.10", { TELEGRAM_WEBHOOK_SECRET: "test-secret-a" });
  const rotated = sourceIdentifierHash("203.0.113.10", { TELEGRAM_WEBHOOK_SECRET: "test-secret-b" });
  assert.equal(first, repeated);
  assert.notEqual(first, rotated);
  assert.doesNotMatch(first, /203\.0\.113\.10/);
});
