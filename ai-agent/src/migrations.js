import crypto from "node:crypto";

export const PLATFORM_MIGRATIONS = Object.freeze([
  Object.freeze({
    version: "2026071501_platform_foundation",
    sql: `
      CREATE TABLE IF NOT EXISTS platform_users (
        user_id BIGINT PRIMARY KEY CHECK (user_id > 0),
        role TEXT NOT NULL DEFAULT 'standard_user'
          CHECK (role IN ('super_admin', 'admin', 'moderator', 'support', 'premium_user', 'standard_user', 'restricted_user', 'banned_user')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS feature_flags (
        feature_key TEXT PRIMARY KEY CHECK (feature_key ~ '^[a-z][a-z0-9_]{1,63}$'),
        enabled BOOLEAN NOT NULL DEFAULT FALSE,
        description TEXT NOT NULL DEFAULT '',
        config JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(config) = 'object'),
        updated_by BIGINT REFERENCES platform_users(user_id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
        audit_id BIGSERIAL PRIMARY KEY,
        request_id UUID UNIQUE,
        actor_user_id BIGINT REFERENCES platform_users(user_id) ON DELETE SET NULL,
        action TEXT NOT NULL CHECK (length(action) BETWEEN 1 AND 128),
        target_type TEXT CHECK (target_type IS NULL OR length(target_type) BETWEEN 1 AND 64),
        target_id TEXT CHECK (target_id IS NULL OR length(target_id) BETWEEN 1 AND 256),
        result TEXT NOT NULL DEFAULT 'success' CHECK (result IN ('success', 'denied', 'failed', 'duplicate')),
        reason TEXT CHECK (reason IS NULL OR length(reason) <= 1000),
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS audit_logs_actor_created_idx
        ON audit_logs(actor_user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS audit_logs_action_created_idx
        ON audit_logs(action, created_at DESC);

      CREATE TABLE IF NOT EXISTS security_events (
        security_event_id BIGSERIAL PRIMARY KEY,
        event_type TEXT NOT NULL CHECK (length(event_type) BETWEEN 1 AND 128),
        severity TEXT NOT NULL CHECK (severity IN ('info', 'low', 'medium', 'high', 'critical')),
        user_id BIGINT REFERENCES platform_users(user_id) ON DELETE SET NULL,
        request_id UUID,
        source_hash TEXT CHECK (source_hash IS NULL OR length(source_hash) <= 128),
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS security_events_type_created_idx
        ON security_events(event_type, created_at DESC);
      CREATE INDEX IF NOT EXISTS security_events_severity_created_idx
        ON security_events(severity, created_at DESC);
    `
  }),
  Object.freeze({
    version: "2026071502_foundation_feature_flags",
    sql: `
      INSERT INTO feature_flags (feature_key, enabled, description)
      VALUES
        ('admin_api', TRUE, 'Authenticated administrator API foundation'),
        ('audit_logging', TRUE, 'Durable administrative audit logging'),
        ('security_events', TRUE, 'Durable security event recording'),
        ('group_management', FALSE, 'Telegram group management controls'),
        ('ai_moderation', FALSE, 'NVIDIA-assisted moderation classification'),
        ('bot_management', FALSE, 'Managed bot profiles and encrypted credentials')
      ON CONFLICT (feature_key) DO NOTHING;
    `
  }),
  Object.freeze({
    version: "2026071503_nvidia_model_controls",
    sql: `
      CREATE TABLE IF NOT EXISTS ai_models (
        model_id TEXT PRIMARY KEY
          CHECK (model_id ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{1,199}$'),
        label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 200),
        description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 1000),
        enabled BOOLEAN NOT NULL DEFAULT FALSE,
        featured BOOLEAN NOT NULL DEFAULT FALSE,
        provider_available BOOLEAN NOT NULL DEFAULT TRUE,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
        last_seen_at TIMESTAMPTZ,
        updated_by BIGINT REFERENCES platform_users(user_id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS ai_models_enabled_featured_idx
        ON ai_models(enabled, featured DESC, model_id);

      INSERT INTO ai_models (model_id, label, description, enabled, featured, metadata)
      VALUES
        ('meta/llama-3.3-70b-instruct', 'Llama 3.3 70B', 'Strong general reasoning and multilingual chat', TRUE, TRUE, '{"tag":"GENERAL"}'::jsonb),
        ('nvidia/llama-3.3-nemotron-super-49b-v1.5', 'Nemotron Super 49B', 'NVIDIA reasoning model for complex questions and planning', TRUE, TRUE, '{"tag":"REASONING"}'::jsonb),
        ('meta/llama-3.1-70b-instruct', 'Llama 3.1 70B', 'Reliable assistant for everyday work', TRUE, FALSE, '{"tag":"BALANCED"}'::jsonb),
        ('meta/llama-3.1-8b-instruct', 'Llama 3.1 8B', 'Lower-latency answers for simple tasks', TRUE, FALSE, '{"tag":"FAST"}'::jsonb)
      ON CONFLICT (model_id) DO NOTHING;
    `
  }),
  Object.freeze({
    version: "2026071504_billing_pricing",
    sql: `
      CREATE TABLE IF NOT EXISTS billing_prices (
        feature_key TEXT PRIMARY KEY CHECK (feature_key ~ '^[a-z][a-z0-9_]{1,63}$'),
        star_cost INTEGER NOT NULL CHECK (star_cost BETWEEN 1 AND 10000),
        updated_by BIGINT REFERENCES platform_users(user_id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      INSERT INTO billing_prices (feature_key, star_cost)
      VALUES ('ai_chat', 1)
      ON CONFLICT (feature_key) DO NOTHING;
    `
  })
]);

function migrationChecksum(migration) {
  return crypto.createHash("sha256").update(`${migration.version}\n${migration.sql}`).digest("hex");
}

export async function runMigrations(pool, { migrations = PLATFORM_MIGRATIONS } = {}) {
  if (!pool?.connect) throw new TypeError("A PostgreSQL pool is required to run migrations");
  const client = await pool.connect();
  const applied = [];
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('nvid-ai-platform-migrations', 0))");
    await client.query(`
      CREATE TABLE IF NOT EXISTS app_schema_migrations (
        version TEXT PRIMARY KEY,
        checksum TEXT NOT NULL CHECK (checksum ~ '^[a-f0-9]{64}$'),
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    const existing = await client.query("SELECT version, checksum FROM app_schema_migrations");
    const checksums = new Map(existing.rows.map((row) => [row.version, row.checksum]));

    for (const migration of migrations) {
      const checksum = migrationChecksum(migration);
      const previousChecksum = checksums.get(migration.version);
      if (previousChecksum && previousChecksum !== checksum) {
        throw new Error(`Migration checksum mismatch for ${migration.version}`);
      }
      if (previousChecksum) continue;
      await client.query(migration.sql);
      await client.query(
        "INSERT INTO app_schema_migrations (version, checksum) VALUES ($1, $2)",
        [migration.version, checksum]
      );
      applied.push(migration.version);
    }
    await client.query("COMMIT");
    return { applied, currentVersion: migrations.at(-1)?.version || null };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Keep the migration failure as the primary error.
    }
    throw error;
  } finally {
    client.release();
  }
}
