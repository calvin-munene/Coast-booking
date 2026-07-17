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
  }),
  Object.freeze({
    version: "2026071505_stabilization_foundation",
    sql: `
      CREATE TABLE IF NOT EXISTS telegram_star_accounts (
        user_id BIGINT PRIMARY KEY,
        balance BIGINT NOT NULL DEFAULT 0 CHECK (balance >= 0),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS telegram_star_payments (
        telegram_payment_charge_id TEXT PRIMARY KEY,
        provider_payment_charge_id TEXT,
        user_id BIGINT NOT NULL REFERENCES telegram_star_accounts(user_id),
        amount INTEGER NOT NULL CHECK (amount BETWEEN 1 AND 10000),
        currency TEXT NOT NULL CHECK (currency = 'XTR'),
        invoice_payload TEXT,
        credited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        refunded_at TIMESTAMPTZ,
        refunded_amount INTEGER CHECK (refunded_amount BETWEEN 1 AND 10000)
      );
      CREATE INDEX IF NOT EXISTS telegram_star_payments_user_id_idx
        ON telegram_star_payments(user_id, credited_at DESC);

      CREATE TABLE IF NOT EXISTS telegram_star_terms_acceptances (
        user_id BIGINT NOT NULL REFERENCES telegram_star_accounts(user_id),
        terms_version TEXT NOT NULL,
        accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (user_id, terms_version)
      );

      CREATE TABLE IF NOT EXISTS telegram_star_prompt_reservations (
        reservation_id TEXT PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES telegram_star_accounts(user_id),
        cost INTEGER NOT NULL CHECK (cost BETWEEN 1 AND 10000),
        status TEXT NOT NULL DEFAULT 'reserved',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMPTZ,
        restored_at TIMESTAMPTZ
      );
      ALTER TABLE telegram_star_prompt_reservations
        ADD COLUMN IF NOT EXISTS generation_started_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS response_produced_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS delivery_attempted_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS completion_pending_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS failed_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS last_error_code TEXT;
      ALTER TABLE telegram_star_prompt_reservations
        DROP CONSTRAINT IF EXISTS telegram_star_prompt_reservations_status_check;
      ALTER TABLE telegram_star_prompt_reservations
        ADD CONSTRAINT telegram_star_prompt_reservations_status_check
        CHECK (status IN (
          'reserved', 'generation_started', 'response_produced', 'delivery_attempted',
          'delivered', 'completion_pending', 'completed', 'restored', 'failed'
        ));
      CREATE INDEX IF NOT EXISTS telegram_star_prompt_reservations_refundable_idx
        ON telegram_star_prompt_reservations(created_at)
        WHERE status IN ('reserved', 'generation_started', 'failed');
      CREATE INDEX IF NOT EXISTS telegram_star_prompt_reservations_recovery_idx
        ON telegram_star_prompt_reservations(updated_at, reservation_id)
        WHERE status IN ('response_produced', 'delivery_attempted', 'delivered', 'completion_pending');

      CREATE TABLE IF NOT EXISTS telegram_bot_modes (
        mode TEXT PRIMARY KEY,
        enabled BOOLEAN NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS telegram_user_controls (
        user_id BIGINT PRIMARY KEY REFERENCES telegram_star_accounts(user_id),
        banned BOOLEAN NOT NULL DEFAULT FALSE,
        ban_reason TEXT,
        unlimited_credits BOOLEAN NOT NULL DEFAULT FALSE,
        persona TEXT,
        selected_mode TEXT NOT NULL DEFAULT 'chat',
        preferred_model TEXT,
        preferred_language TEXT NOT NULL DEFAULT 'auto',
        response_length TEXT NOT NULL DEFAULT 'balanced',
        creativity NUMERIC(3,2) NOT NULL DEFAULT 0.40,
        memory_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        custom_instructions TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      ALTER TABLE telegram_user_controls
        ADD COLUMN IF NOT EXISTS selected_mode TEXT NOT NULL DEFAULT 'chat',
        ADD COLUMN IF NOT EXISTS preferred_model TEXT,
        ADD COLUMN IF NOT EXISTS preferred_language TEXT NOT NULL DEFAULT 'auto',
        ADD COLUMN IF NOT EXISTS response_length TEXT NOT NULL DEFAULT 'balanced',
        ADD COLUMN IF NOT EXISTS creativity NUMERIC(3,2) NOT NULL DEFAULT 0.40,
        ADD COLUMN IF NOT EXISTS memory_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        ADD COLUMN IF NOT EXISTS custom_instructions TEXT;

      CREATE TABLE IF NOT EXISTS ai_provider_usage_buckets (
        provider_key TEXT NOT NULL,
        bucket_start TIMESTAMPTZ NOT NULL,
        used INTEGER NOT NULL CHECK (used >= 0),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (provider_key, bucket_start)
      );

      CREATE TABLE IF NOT EXISTS assistants (
        assistant_id UUID PRIMARY KEY,
        owner_user_id BIGINT NOT NULL REFERENCES platform_users(user_id) ON DELETE CASCADE,
        name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
        description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 500),
        system_instructions TEXT NOT NULL DEFAULT '' CHECK (length(system_instructions) <= 5000),
        tone TEXT NOT NULL DEFAULT 'adaptive' CHECK (length(tone) BETWEEN 1 AND 40),
        language TEXT NOT NULL DEFAULT 'auto' CHECK (length(language) BETWEEN 1 AND 32),
        technical_level TEXT NOT NULL DEFAULT 'adaptive' CHECK (technical_level IN ('simple', 'adaptive', 'technical', 'expert')),
        response_length TEXT NOT NULL DEFAULT 'balanced' CHECK (response_length IN ('concise', 'balanced', 'detailed')),
        selected_model TEXT,
        memory_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS assistants_owner_updated_idx
        ON assistants(owner_user_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS conversations (
        conversation_id UUID PRIMARY KEY,
        scope_key TEXT NOT NULL CHECK (length(scope_key) BETWEEN 1 AND 500),
        user_id BIGINT NOT NULL REFERENCES platform_users(user_id) ON DELETE CASCADE,
        telegram_chat_id BIGINT,
        telegram_thread_id BIGINT,
        channel TEXT NOT NULL CHECK (channel IN ('telegram', 'miniapp', 'whatsapp')),
        assistant_id UUID REFERENCES assistants(assistant_id) ON DELETE SET NULL,
        selected_model TEXT,
        title TEXT NOT NULL DEFAULT 'New conversation' CHECK (length(title) BETWEEN 1 AND 160),
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ,
        CHECK ((channel = 'telegram' AND telegram_chat_id IS NOT NULL) OR channel <> 'telegram')
      );
      CREATE INDEX IF NOT EXISTS conversations_user_history_idx
        ON conversations(user_id, updated_at DESC) WHERE deleted_at IS NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS conversations_active_scope_uidx
        ON conversations(scope_key) WHERE deleted_at IS NULL;
      CREATE INDEX IF NOT EXISTS conversations_active_idx
        ON conversations(user_id, status, updated_at DESC) WHERE deleted_at IS NULL;
      CREATE INDEX IF NOT EXISTS conversations_telegram_scope_idx
        ON conversations(telegram_chat_id, telegram_thread_id, user_id) WHERE deleted_at IS NULL;

      CREATE TABLE IF NOT EXISTS conversation_messages (
        message_id UUID PRIMARY KEY,
        conversation_id UUID NOT NULL REFERENCES conversations(conversation_id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
        content TEXT NOT NULL CHECK (length(content) BETWEEN 1 AND 20000),
        model TEXT,
        provider_request_id TEXT,
        status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('pending', 'generating', 'completed', 'failed')),
        usage_metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(usage_metadata) = 'object'),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS conversation_messages_order_idx
        ON conversation_messages(conversation_id, created_at, message_id);

      CREATE TABLE IF NOT EXISTS durable_leases (
        lease_key TEXT PRIMARY KEY CHECK (length(lease_key) BETWEEN 1 AND 500),
        owner_id UUID NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS durable_leases_expiry_idx ON durable_leases(expires_at);

      CREATE TABLE IF NOT EXISTS telegram_webapp_replays (
        fingerprint TEXT PRIMARY KEY CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
        user_id BIGINT NOT NULL REFERENCES platform_users(user_id) ON DELETE CASCADE,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS telegram_webapp_replays_expiry_idx ON telegram_webapp_replays(expires_at);

      CREATE TABLE IF NOT EXISTS shared_rate_limits (
        limit_key TEXT NOT NULL CHECK (length(limit_key) BETWEEN 1 AND 500),
        window_start TIMESTAMPTZ NOT NULL,
        used INTEGER NOT NULL CHECK (used >= 0),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (limit_key, window_start)
      );
      CREATE INDEX IF NOT EXISTS shared_rate_limits_expiry_idx ON shared_rate_limits(window_start);

      INSERT INTO feature_flags (feature_key, enabled, description)
      VALUES ('whatsapp_ai', FALSE, 'WhatsApp AI inference requires explicit entitlement rollout')
      ON CONFLICT (feature_key) DO NOTHING;
    `
  }),
  Object.freeze({
    version: "2026071701_operating_services",
    sql: `
      ALTER TABLE platform_users
        ADD COLUMN IF NOT EXISTS first_name TEXT CHECK (first_name IS NULL OR length(first_name) <= 128),
        ADD COLUMN IF NOT EXISTS last_name TEXT CHECK (last_name IS NULL OR length(last_name) <= 128),
        ADD COLUMN IF NOT EXISTS username TEXT CHECK (username IS NULL OR length(username) <= 64);
      CREATE INDEX IF NOT EXISTS platform_users_username_idx
        ON platform_users (lower(username)) WHERE username IS NOT NULL;

      CREATE TABLE IF NOT EXISTS user_admin_notes (
        note_id UUID PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES platform_users(user_id) ON DELETE CASCADE,
        author_user_id BIGINT REFERENCES platform_users(user_id) ON DELETE SET NULL,
        note TEXT NOT NULL CHECK (length(note) BETWEEN 1 AND 2000),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS user_admin_notes_user_created_idx
        ON user_admin_notes(user_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS telegram_groups (
        chat_id BIGINT PRIMARY KEY CHECK (chat_id <> 0),
        title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 255),
        username TEXT CHECK (username IS NULL OR length(username) <= 64),
        chat_type TEXT NOT NULL CHECK (chat_type IN ('group', 'supergroup', 'channel')),
        active BOOLEAN NOT NULL DEFAULT TRUE,
        bot_status TEXT NOT NULL DEFAULT 'member'
          CHECK (bot_status IN ('creator', 'administrator', 'member', 'restricted', 'left', 'kicked', 'unknown')),
        bot_permissions JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(bot_permissions) = 'object'),
        member_count INTEGER CHECK (member_count IS NULL OR member_count >= 0),
        last_event_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS telegram_groups_active_updated_idx
        ON telegram_groups(active, updated_at DESC);

      CREATE TABLE IF NOT EXISTS telegram_group_settings (
        chat_id BIGINT PRIMARY KEY REFERENCES telegram_groups(chat_id) ON DELETE CASCADE,
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        moderation_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        guard_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        secretary_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        welcome_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        welcome_message TEXT CHECK (welcome_message IS NULL OR length(welcome_message) <= 2000),
        goodbye_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        goodbye_message TEXT CHECK (goodbye_message IS NULL OR length(goodbye_message) <= 2000),
        rules TEXT CHECK (rules IS NULL OR length(rules) <= 10000),
        warning_threshold INTEGER NOT NULL DEFAULT 3 CHECK (warning_threshold BETWEEN 1 AND 20),
        warning_action TEXT NOT NULL DEFAULT 'mute'
          CHECK (warning_action IN ('none', 'mute', 'kick', 'ban')),
        warning_mute_seconds INTEGER NOT NULL DEFAULT 3600 CHECK (warning_mute_seconds BETWEEN 30 AND 31536000),
        anti_flood_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        anti_link_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        anti_caps_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        anti_spam_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        blocked_words JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(blocked_words) = 'array'),
        allowed_domains JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(allowed_domains) = 'array'),
        blocked_domains JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(blocked_domains) = 'array'),
        guard_policy JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(guard_policy) = 'object'),
        secretary_policy JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(secretary_policy) = 'object'),
        updated_by BIGINT REFERENCES platform_users(user_id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS telegram_group_members (
        chat_id BIGINT NOT NULL REFERENCES telegram_groups(chat_id) ON DELETE CASCADE,
        user_id BIGINT NOT NULL REFERENCES platform_users(user_id) ON DELETE CASCADE,
        telegram_status TEXT NOT NULL DEFAULT 'member'
          CHECK (telegram_status IN ('creator', 'administrator', 'member', 'restricted', 'left', 'kicked', 'unknown')),
        permissions JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(permissions) = 'object'),
        joined_at TIMESTAMPTZ,
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (chat_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS telegram_group_members_user_idx
        ON telegram_group_members(user_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS group_moderation_actions (
        action_id UUID PRIMARY KEY,
        request_id UUID UNIQUE,
        chat_id BIGINT NOT NULL REFERENCES telegram_groups(chat_id) ON DELETE CASCADE,
        actor_user_id BIGINT REFERENCES platform_users(user_id) ON DELETE SET NULL,
        target_user_id BIGINT REFERENCES platform_users(user_id) ON DELETE SET NULL,
        action TEXT NOT NULL CHECK (action IN (
          'ban', 'unban', 'kick', 'mute', 'unmute', 'warn', 'unwarn', 'delete', 'purge',
          'pin', 'unpin', 'lock', 'unlock', 'slowmode', 'approve', 'reject', 'report', 'automatic_flag'
        )),
        reason TEXT CHECK (reason IS NULL OR length(reason) <= 1000),
        duration_seconds INTEGER CHECK (duration_seconds IS NULL OR duration_seconds BETWEEN 1 AND 31536000),
        telegram_message_id BIGINT,
        result TEXT NOT NULL CHECK (result IN ('success', 'denied', 'failed', 'pending')),
        reversible BOOLEAN NOT NULL DEFAULT FALSE,
        reversed_at TIMESTAMPTZ,
        reversed_by BIGINT REFERENCES platform_users(user_id) ON DELETE SET NULL,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS group_moderation_actions_chat_created_idx
        ON group_moderation_actions(chat_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS group_moderation_actions_target_created_idx
        ON group_moderation_actions(target_user_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS group_warnings (
        warning_id UUID PRIMARY KEY,
        chat_id BIGINT NOT NULL REFERENCES telegram_groups(chat_id) ON DELETE CASCADE,
        user_id BIGINT NOT NULL REFERENCES platform_users(user_id) ON DELETE CASCADE,
        issued_by BIGINT REFERENCES platform_users(user_id) ON DELETE SET NULL,
        reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 1000),
        active BOOLEAN NOT NULL DEFAULT TRUE,
        removed_at TIMESTAMPTZ,
        removed_by BIGINT REFERENCES platform_users(user_id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS group_warnings_active_idx
        ON group_warnings(chat_id, user_id, created_at DESC) WHERE active = TRUE;

      CREATE TABLE IF NOT EXISTS moderation_appeals (
        appeal_id UUID PRIMARY KEY,
        action_id UUID NOT NULL REFERENCES group_moderation_actions(action_id) ON DELETE CASCADE,
        appellant_user_id BIGINT NOT NULL REFERENCES platform_users(user_id) ON DELETE CASCADE,
        message TEXT NOT NULL CHECK (length(message) BETWEEN 1 AND 2000),
        status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'accepted', 'rejected', 'withdrawn')),
        reviewed_by BIGINT REFERENCES platform_users(user_id) ON DELETE SET NULL,
        review_note TEXT CHECK (review_note IS NULL OR length(review_note) <= 2000),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        reviewed_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS moderation_appeals_status_idx
        ON moderation_appeals(status, created_at DESC);

      CREATE TABLE IF NOT EXISTS guard_join_requests (
        join_request_id UUID PRIMARY KEY,
        chat_id BIGINT NOT NULL REFERENCES telegram_groups(chat_id) ON DELETE CASCADE,
        user_id BIGINT NOT NULL REFERENCES platform_users(user_id) ON DELETE CASCADE,
        requested_at TIMESTAMPTZ NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued'
          CHECK (status IN ('queued', 'verification_pending', 'approved', 'rejected', 'cancelled', 'expired')),
        user_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(user_snapshot) = 'object'),
        invite_link_fingerprint TEXT,
        verification_token_hash TEXT,
        verification_expires_at TIMESTAMPTZ,
        decided_by BIGINT REFERENCES platform_users(user_id) ON DELETE SET NULL,
        decision_reason TEXT CHECK (decision_reason IS NULL OR length(decision_reason) <= 1000),
        decided_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (chat_id, user_id, requested_at)
      );
      CREATE INDEX IF NOT EXISTS guard_join_requests_queue_idx
        ON guard_join_requests(chat_id, requested_at) WHERE status IN ('queued', 'verification_pending');

      CREATE TABLE IF NOT EXISTS guard_decisions (
        decision_id UUID PRIMARY KEY,
        join_request_id UUID NOT NULL REFERENCES guard_join_requests(join_request_id) ON DELETE CASCADE,
        actor_user_id BIGINT REFERENCES platform_users(user_id) ON DELETE SET NULL,
        decision TEXT NOT NULL CHECK (decision IN ('queue', 'request_verification', 'approve', 'reject', 'expire', 'cancel')),
        reason TEXT CHECK (reason IS NULL OR length(reason) <= 1000),
        signals JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(signals) = 'object'),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS guard_decisions_request_created_idx
        ON guard_decisions(join_request_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS secretary_reminders (
        reminder_id UUID PRIMARY KEY,
        owner_user_id BIGINT NOT NULL REFERENCES platform_users(user_id) ON DELETE CASCADE,
        chat_id BIGINT,
        thread_id BIGINT,
        title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
        message TEXT NOT NULL CHECK (length(message) BETWEEN 1 AND 2000),
        due_at TIMESTAMPTZ NOT NULL,
        status TEXT NOT NULL DEFAULT 'scheduled'
          CHECK (status IN ('scheduled', 'claimed', 'delivered', 'cancelled', 'failed')),
        delivery_attempts INTEGER NOT NULL DEFAULT 0 CHECK (delivery_attempts BETWEEN 0 AND 20),
        claimed_by UUID,
        claim_expires_at TIMESTAMPTZ,
        delivered_at TIMESTAMPTZ,
        last_error_code TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS secretary_reminders_due_idx
        ON secretary_reminders(due_at, reminder_id) WHERE status IN ('scheduled', 'claimed');
      CREATE INDEX IF NOT EXISTS secretary_reminders_owner_idx
        ON secretary_reminders(owner_user_id, due_at DESC);

      CREATE TABLE IF NOT EXISTS secretary_jobs (
        job_id UUID PRIMARY KEY,
        owner_user_id BIGINT NOT NULL REFERENCES platform_users(user_id) ON DELETE CASCADE,
        chat_id BIGINT REFERENCES telegram_groups(chat_id) ON DELETE CASCADE,
        thread_id BIGINT,
        job_type TEXT NOT NULL CHECK (job_type IN ('daily_summary', 'topic_summary', 'meeting_notes', 'task_digest')),
        schedule TEXT NOT NULL CHECK (length(schedule) BETWEEN 1 AND 100),
        timezone TEXT NOT NULL DEFAULT 'UTC' CHECK (length(timezone) BETWEEN 1 AND 64),
        status TEXT NOT NULL DEFAULT 'enabled' CHECK (status IN ('enabled', 'paused', 'failed')),
        configuration JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(configuration) = 'object'),
        next_run_at TIMESTAMPTZ,
        last_run_at TIMESTAMPTZ,
        last_error_code TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS secretary_jobs_due_idx
        ON secretary_jobs(next_run_at, job_id) WHERE status = 'enabled';

      CREATE TABLE IF NOT EXISTS managed_bot_profiles (
        bot_profile_id UUID PRIMARY KEY,
        owner_user_id BIGINT NOT NULL REFERENCES platform_users(user_id) ON DELETE CASCADE,
        display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 100),
        telegram_bot_id BIGINT,
        telegram_username TEXT CHECK (telegram_username IS NULL OR length(telegram_username) <= 64),
        status TEXT NOT NULL DEFAULT 'draft'
          CHECK (status IN ('draft', 'configured', 'connected', 'error', 'disabled')),
        configuration JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(configuration) = 'object'),
        last_health_at TIMESTAMPTZ,
        last_error_code TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (telegram_bot_id)
      );
      CREATE INDEX IF NOT EXISTS managed_bot_profiles_owner_idx
        ON managed_bot_profiles(owner_user_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS managed_bot_credentials (
        bot_profile_id UUID PRIMARY KEY REFERENCES managed_bot_profiles(bot_profile_id) ON DELETE CASCADE,
        ciphertext TEXT NOT NULL,
        iv TEXT NOT NULL,
        auth_tag TEXT NOT NULL,
        key_version TEXT NOT NULL CHECK (length(key_version) BETWEEN 1 AND 64),
        token_fingerprint TEXT NOT NULL CHECK (token_fingerprint ~ '^[a-f0-9]{64}$'),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      INSERT INTO feature_flags (feature_key, enabled, description)
      VALUES
        ('guard_mode', FALSE, 'Persistent Telegram group join-request verification'),
        ('secretary_automation', FALSE, 'Scheduled reminders and authorized group productivity jobs'),
        ('managed_bots', FALSE, 'Encrypted managed bot profiles and connectivity operations')
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
