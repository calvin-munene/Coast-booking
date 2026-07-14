import crypto from "node:crypto";
import { runMigrations } from "./migrations.js";
import { normalizePlatformRole } from "./rbac.js";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FEATURE_KEY = /^[a-z][a-z0-9_]{1,63}$/;
const MAX_INT64 = 9_223_372_036_854_775_807n;

function normalizeUserId(value) {
  const text = String(value ?? "");
  if (!/^[1-9]\d*$/.test(text) || BigInt(text) > MAX_INT64) throw new TypeError("userId must be a positive Telegram user ID");
  return BigInt(text).toString();
}

function normalizeRequestId(value, { optional = false } = {}) {
  const text = String(value || "");
  if (!text && optional) return null;
  if (!UUID_V4.test(text)) throw new TypeError("requestId must be a UUID v4");
  return text.toLowerCase();
}

function normalizeFeatureKey(value) {
  const key = String(value || "").trim().toLowerCase();
  if (!FEATURE_KEY.test(key)) throw new TypeError("featureKey is invalid");
  return key;
}

function normalizeLimit(value, fallback = 50, maximum = 250) {
  const parsed = Number(value ?? fallback);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= maximum ? parsed : fallback;
}

function normalizeMetadata(value) {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) throw new TypeError("metadata must be an object");
  return value;
}

function featureRow(row) {
  return {
    key: row.feature_key,
    enabled: row.enabled === true,
    description: row.description || "",
    config: row.config || {},
    updatedBy: row.updated_by === null || row.updated_by === undefined ? null : String(row.updated_by),
    updatedAt: row.updated_at
  };
}

export function sourceIdentifierHash(source, env = process.env) {
  const value = String(source || "unknown");
  const key = env.TELEGRAM_STAR_SIGNING_SECRET || env.TELEGRAM_WEBHOOK_SECRET || "nvid-ai-local-source-hash";
  return crypto.createHmac("sha256", key).update(value).digest("hex");
}

export function createPlatformStore({ pool: injectedPool, connectionString = process.env.DATABASE_URL } = {}) {
  let pool = injectedPool || null;
  let ownsPool = false;
  let poolPromise = null;
  let initPromise = null;
  let closed = false;
  let migrationState = { applied: [], currentVersion: null };

  async function resolvePool() {
    if (closed) throw new Error("Platform store is closed");
    if (pool) return pool;
    if (poolPromise) return poolPromise;
    if (!connectionString) throw new Error("DATABASE_URL is required for the platform store");
    poolPromise = import("pg").then(({ Pool }) => {
      pool = new Pool({ connectionString });
      ownsPool = true;
      return pool;
    }).catch((error) => {
      poolPromise = null;
      throw error;
    });
    return poolPromise;
  }

  async function init() {
    if (initPromise) return initPromise;
    initPromise = resolvePool().then(async (resolvedPool) => {
      migrationState = await runMigrations(resolvedPool);
      return migrationState;
    }).catch((error) => {
      initPromise = null;
      throw error;
    });
    return initPromise;
  }

  async function transaction(work) {
    if (typeof work !== "function") throw new TypeError("transaction work must be a function");
    await init();
    const resolvedPool = await resolvePool();
    const client = await resolvedPool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the original transaction failure.
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async function ensureUserWithClient(client, rawUserId) {
    const userId = normalizeUserId(rawUserId);
    const result = await client.query(
      `INSERT INTO platform_users (user_id, last_seen_at, updated_at)
       VALUES ($1, NOW(), NOW())
       ON CONFLICT (user_id)
       DO UPDATE SET last_seen_at = NOW()
       RETURNING user_id::text, role, created_at, last_seen_at, updated_at`,
      [userId]
    );
    return result.rows[0];
  }

  async function ensureUser(rawUserId) {
    return transaction((client) => ensureUserWithClient(client, rawUserId));
  }

  async function getUserRole(rawUserId) {
    const row = await ensureUser(rawUserId);
    return normalizePlatformRole(row.role);
  }

  async function setUserRole({ actorUserId, userId: rawUserId, role, requestId }) {
    const actor = normalizeUserId(actorUserId);
    const userId = normalizeUserId(rawUserId);
    const normalizedRole = normalizePlatformRole(role);
    const operationId = normalizeRequestId(requestId);
    return transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [operationId]);
      const duplicate = await client.query("SELECT action, target_id, metadata FROM audit_logs WHERE request_id = $1", [operationId]);
      if (duplicate.rowCount) {
        const previous = duplicate.rows[0];
        if (previous.action !== "platform_user.role.set" || previous.target_id !== userId || previous.metadata?.role !== normalizedRole) {
          const error = new Error("requestId was already used for a different operation");
          error.statusCode = 409;
          throw error;
        }
        return { duplicate: true, userId, role: normalizedRole };
      }
      await ensureUserWithClient(client, actor);
      await ensureUserWithClient(client, userId);
      const changed = await client.query(
        `UPDATE platform_users SET role = $2, updated_at = NOW() WHERE user_id = $1
         RETURNING user_id::text, role, updated_at`,
        [userId, normalizedRole]
      );
      await client.query(
        `INSERT INTO audit_logs (request_id, actor_user_id, action, target_type, target_id, metadata)
         VALUES ($1, $2, 'platform_user.role.set', 'user', $3, $4::jsonb)`,
        [operationId, actor, userId, JSON.stringify({ role: normalizedRole })]
      );
      return { duplicate: false, userId: changed.rows[0].user_id, role: changed.rows[0].role };
    });
  }

  async function listFeatureFlags() {
    await init();
    const resolvedPool = await resolvePool();
    const result = await resolvedPool.query(
      `SELECT feature_key, enabled, description, config, updated_by::text, updated_at
       FROM feature_flags ORDER BY feature_key`
    );
    return result.rows.map(featureRow);
  }

  async function getFeatureFlag(rawFeatureKey) {
    const featureKey = normalizeFeatureKey(rawFeatureKey);
    await init();
    const resolvedPool = await resolvePool();
    const result = await resolvedPool.query(
      `SELECT feature_key, enabled, description, config, updated_by::text, updated_at
       FROM feature_flags WHERE feature_key = $1`,
      [featureKey]
    );
    return result.rowCount ? featureRow(result.rows[0]) : null;
  }

  async function isFeatureEnabled(featureKey) {
    return (await getFeatureFlag(featureKey))?.enabled === true;
  }

  async function setFeatureFlag({ actorUserId, featureKey: rawFeatureKey, enabled, requestId }) {
    const actor = normalizeUserId(actorUserId);
    const featureKey = normalizeFeatureKey(rawFeatureKey);
    if (typeof enabled !== "boolean") throw new TypeError("enabled must be a boolean");
    const operationId = normalizeRequestId(requestId);
    return transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [operationId]);
      const duplicate = await client.query("SELECT action, target_id, metadata FROM audit_logs WHERE request_id = $1", [operationId]);
      if (duplicate.rowCount) {
        const previous = duplicate.rows[0];
        if (previous.action !== "feature_flag.updated" || previous.target_id !== featureKey || previous.metadata?.enabled !== enabled) {
          const error = new Error("requestId was already used for a different operation");
          error.statusCode = 409;
          throw error;
        }
        const current = await client.query(
          `SELECT feature_key, enabled, description, config, updated_by::text, updated_at
           FROM feature_flags WHERE feature_key = $1`,
          [featureKey]
        );
        return { duplicate: true, feature: current.rowCount ? featureRow(current.rows[0]) : null };
      }
      await ensureUserWithClient(client, actor);
      const changed = await client.query(
        `UPDATE feature_flags SET enabled = $2, updated_by = $3, updated_at = NOW()
         WHERE feature_key = $1
         RETURNING feature_key, enabled, description, config, updated_by::text, updated_at`,
        [featureKey, enabled, actor]
      );
      if (!changed.rowCount) {
        const error = new Error("Unknown feature flag");
        error.statusCode = 404;
        throw error;
      }
      await client.query(
        `INSERT INTO audit_logs (request_id, actor_user_id, action, target_type, target_id, metadata)
         VALUES ($1, $2, 'feature_flag.updated', 'feature_flag', $3, $4::jsonb)`,
        [operationId, actor, featureKey, JSON.stringify({ enabled })]
      );
      return { duplicate: false, feature: featureRow(changed.rows[0]) };
    });
  }

  async function writeAudit({ requestId, actorUserId, action, targetType = null, targetId = null, result = "success", reason = null, metadata = {} }) {
    const actor = actorUserId === undefined || actorUserId === null ? null : normalizeUserId(actorUserId);
    const operationId = normalizeRequestId(requestId, { optional: true });
    if (typeof action !== "string" || action.length < 1 || action.length > 128) throw new TypeError("action is invalid");
    const safeMetadata = normalizeMetadata(metadata);
    return transaction(async (client) => {
      if (actor) await ensureUserWithClient(client, actor);
      const inserted = await client.query(
        `INSERT INTO audit_logs (request_id, actor_user_id, action, target_type, target_id, result, reason, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
         ON CONFLICT (request_id) DO NOTHING
         RETURNING audit_id::text, created_at`,
        [operationId, actor, action, targetType, targetId, result, reason, JSON.stringify(safeMetadata)]
      );
      return { written: inserted.rowCount === 1, auditId: inserted.rows[0]?.audit_id || null };
    });
  }

  async function writeSecurityEvent({ eventType, severity = "info", userId: rawUserId = null, requestId = null, sourceHash = null, metadata = {} }) {
    const userId = rawUserId === null || rawUserId === undefined ? null : normalizeUserId(rawUserId);
    const operationId = normalizeRequestId(requestId, { optional: true });
    if (typeof eventType !== "string" || eventType.length < 1 || eventType.length > 128) throw new TypeError("eventType is invalid");
    if (!["info", "low", "medium", "high", "critical"].includes(severity)) throw new TypeError("severity is invalid");
    const safeMetadata = normalizeMetadata(metadata);
    return transaction(async (client) => {
      if (userId) await ensureUserWithClient(client, userId);
      const inserted = await client.query(
        `INSERT INTO security_events (event_type, severity, user_id, request_id, source_hash, metadata)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)
         RETURNING security_event_id::text, created_at`,
        [eventType, severity, userId, operationId, sourceHash, JSON.stringify(safeMetadata)]
      );
      return { written: true, securityEventId: inserted.rows[0].security_event_id };
    });
  }

  async function getOverview() {
    await init();
    const resolvedPool = await resolvePool();
    const result = await resolvedPool.query(`
      SELECT
        (SELECT COUNT(*)::text FROM platform_users) AS total_users,
        (SELECT COUNT(*)::text FROM platform_users WHERE last_seen_at >= NOW() - INTERVAL '30 days') AS active_users,
        (SELECT COUNT(*)::text FROM platform_users WHERE created_at >= NOW() - INTERVAL '7 days') AS new_users,
        (SELECT COUNT(*)::text FROM audit_logs) AS audit_events,
        (SELECT COUNT(*)::text FROM security_events WHERE created_at >= NOW() - INTERVAL '24 hours') AS recent_security_events
    `);
    const row = result.rows[0];
    return {
      totalUsers: row.total_users,
      activeUsers: row.active_users,
      newUsers: row.new_users,
      auditEvents: row.audit_events,
      recentSecurityEvents: row.recent_security_events
    };
  }

  async function listAuditLogs({ limit } = {}) {
    await init();
    const resolvedPool = await resolvePool();
    const result = await resolvedPool.query(
      `SELECT audit_id::text, request_id::text, actor_user_id::text, action, target_type, target_id, result, reason, metadata, created_at
       FROM audit_logs ORDER BY created_at DESC, audit_id DESC LIMIT $1`,
      [normalizeLimit(limit)]
    );
    return result.rows;
  }

  async function listSecurityEvents({ limit } = {}) {
    await init();
    const resolvedPool = await resolvePool();
    const result = await resolvedPool.query(
      `SELECT security_event_id::text, event_type, severity, user_id::text, request_id::text, metadata, created_at
       FROM security_events ORDER BY created_at DESC, security_event_id DESC LIMIT $1`,
      [normalizeLimit(limit)]
    );
    return result.rows;
  }

  async function health() {
    const started = Date.now();
    await init();
    const resolvedPool = await resolvePool();
    await resolvedPool.query("SELECT 1 AS ok");
    return { ok: true, latencyMs: Date.now() - started, migrationVersion: migrationState.currentVersion };
  }

  async function close() {
    if (closed) return;
    closed = true;
    if (poolPromise) {
      try {
        await poolPromise;
      } catch {
        return;
      }
    }
    if (ownsPool && pool?.end) await pool.end();
  }

  return {
    init,
    transaction,
    ensureUser,
    getUserRole,
    setUserRole,
    listFeatureFlags,
    getFeatureFlag,
    isFeatureEnabled,
    setFeatureFlag,
    writeAudit,
    writeSecurityEvent,
    getOverview,
    listAuditLogs,
    listSecurityEvents,
    health,
    close
  };
}
