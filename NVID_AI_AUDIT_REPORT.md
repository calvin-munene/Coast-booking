# Nvid AI Phase 1 Audit Report

Date: 2026-07-14
Repository: `C:\Users\USER\Documents\New project`
Audited commit: `a7833d40305306a66b7cd535abbefb50cbc2a6d5`
Production service observed: `https://nvidbot.onrender.com`

## Scope

This audit inspected the existing repository, local runtime behavior, Render deployment state, Telegram/NVIDIA/Stars implementation, Mini App surface, database model, and security posture. No product code was changed, no secrets were printed, no `.env` files were created, and no deployment was triggered.

## Technology Stack

- Runtime: Node.js ESM, native `http` server.
- Web framework: none.
- Telegram integration: direct Bot API calls with `fetch`; no Telegram SDK.
- NVIDIA integration: OpenAI-compatible NVIDIA chat completions API called server-side.
- Database: PostgreSQL through `pg`.
- Frontend: static HTML/CSS/JavaScript for the website and Telegram Mini App.
- Deployment: Render web service.
- Tests: Node built-in test runner.

## Existing Features

- Telegram bot webhook integration.
- NVIDIA AI chat with streaming support.
- Static NVIDIA model catalog with environment allowlist.
- Telegram Stars prepaid credit billing.
- One AI chat prompt consumes one credit for normal users.
- Configured admin/unlimited users bypass credit consumption.
- User controls for ban, unlimited credits, and persona.
- Basic global mode flags.
- Basic Mini App dashboard.
- Telegram `/start`, `/help`, `/dashboard`, `/modes`, `/mode`, `/persona`, `/models`, `/model`, `/reset`, `/balance`, `/topup`, `/terms`, `/paysupport`, `/ban`, `/unban`, `/starbalance`, and `/whoami`.
- Basic guard join-request notification and admin approve/deny callbacks.
- Basic inline query response.
- Telegram draft streaming in private chats and final replies in groups.

## NVIDIA Integration

The NVIDIA API key is loaded from environment variables and used only server-side. The code uses a static model definition list with optional environment allowlisting. It does not currently load model metadata dynamically from NVIDIA, does not persist model configuration in the database, and does not expose model health or per-model admin controls.

## Telegram Stars Billing

The Stars implementation is one of the stronger parts of the current system. It includes signed invoice payloads, terms acceptance, pre-checkout validation, payment idempotency, credit reservations, restoration on AI failure, refund reconciliation, and BIGINT-safe balances. The current model is prepaid credits, not direct transfer of Stars to a Telegram admin user.

## Data Model

The app creates tables at startup rather than through versioned migrations. Current tables cover:

- `telegram_star_accounts`
- `telegram_star_payments`
- `telegram_star_terms_acceptances`
- `telegram_star_prompt_reservations`
- `telegram_bot_modes`
- `telegram_user_controls`

Missing for the requested SaaS platform:

- Versioned migrations.
- Roles and permissions.
- Group records and group settings.
- Group administrator verification cache.
- Conversations and messages.
- Assistants/personas as structured entities.
- Dynamic model configuration.
- Feature flags and mode configuration schemas.
- Moderation rules, actions, warnings, appeals, and logs.
- Admin audit logs and security events.
- Bot profiles and encrypted bot credentials.
- Analytics tables.

## Mini App

The Mini App is currently a static dashboard, not the primary SaaS console yet. It calls the backend with Telegram `initData` and can show user/admin state, but it does not yet implement the required routed app experience, admin dashboard mutations, group controls, Telegram BackButton/MainButton behavior, offline recovery, deep-link routing, or full WebApp SDK patterns.

## Render Deployment

Observed live deployment:

- Service name: `nvidbot`
- URL: `https://nvidbot.onrender.com`
- Live commit: `a7833d4`
- Public checks for health, models, channels, homepage, Mini App, profile image, and welcome image returned 200 during the audit.
- Render build logs showed Node.js `22.16.0`.
- Render PostgreSQL is on a free instance and was observed as expiring on 2026-08-13. This is an urgent data-preservation risk.

There is configuration drift between `render.yaml` and the live service setup. The live service uses root commands that `cd ai-agent`, while `render.yaml` describes an `ai-agent` root service. This should be reconciled before further deployment automation.

## Telegram Capability Support

Technically supported by Telegram and suitable to implement:

- Inline mode, if enabled in BotFather.
- Mini App menu button, main app, direct links, and `startapp` routing.
- Telegram Stars payments for digital goods.
- Join request management when the bot has required permissions.
- Group moderation actions such as ban, unban, restrict, delete, pin, and join request approval when the bot and requesting user have current Telegram permissions.
- Forum topic/thread handling through `message_thread_id`.
- Managed bots, guest bots, bot-to-bot communication, and secretary bots where the current Bot API and BotFather settings support them.

Requires BotFather or Telegram Business configuration:

- Inline mode.
- Bot management/managed bots.
- Guest bot mode.
- Secretary mode or Business connection behavior.
- Bot-to-bot communication.
- Mini App menu button, main app URL, allowed origin, and direct links.

Requires group administrator permissions:

- Ban, kick, mute, restrict, and warning enforcement.
- Delete or bulk-delete messages.
- Pin and unpin messages.
- Approve or decline join requests.
- Invite-link and join-request workflows.
- Any moderation automation.

Important limitation: a normal Telegram bot cannot secretly read private chats or unrelated group history. Secretary behavior must stay inside Telegram Business/user authorization boundaries.

## Security Findings

No high-confidence Telegram/NVIDIA/OpenAI/GitHub/AWS/private-key patterns were found in the tracked worktree or Git history by the local regex scan. However, credentials were pasted into the chat earlier, so they should still be rotated.

Validated findings:

- P2: unauthenticated public `/api/chat` can consume the server-side NVIDIA quota. The route has per-client rate limiting, but no durable user entitlement, global budget, spend circuit breaker, or authenticated quota boundary.
- P3: Telegram Mini App `initData` HMAC is verified but `auth_date` freshness is not enforced, so captured signed launch data can be replayed.
- P3: live Node runtime `22.16.0` is affected by Node CVE-2026-21717 parser HashDoS exposure on public JSON routes. The 1 MB body cap lowers likelihood, but the runtime should still be patched.
- P3/correctness blocker: Telegram topic conversations share chat-level context, so different forum topics can mix history.
- P3/privacy blocker: group members share chat-level AI history/persona behavior, so one user's persona/history can influence another user's group prompt.
- P3/authz blocker: guard approve/deny callbacks trust the platform admin role and do not verify guard mode state, requesting user's current group admin status, or bot permissions before calling Telegram join-request APIs.

## Tests Run

- `node --test` using bundled Node runtime: 49 tests passed, 0 failed.
- Initial dependency audit through `npm audit` could not be rerun in this desktop shell because `npm` is not present on PATH or in the bundled Node bin. The package surface is small (`pg` only), but dependency audit should be rerun in CI/Render or with a full local Node/npm install.

## Implementation Plan

Phase 2 security and data foundation:

- Rotate all previously pasted credentials.
- Upgrade Render Node to a fixed LTS release.
- Upgrade or migrate the free Render PostgreSQL before 2026-08-13.
- Add versioned migrations.
- Add RBAC tables, admin audit logs, security events, feature flags, and mode configuration tables.
- Add Telegram Mini App `auth_date` freshness and replay protection.
- Add authenticated/durable quota controls for `/api/chat`.
- Fix group/topic/user conversation isolation.
- Add permission middleware that verifies current Telegram group admin state before moderation actions.

Phase 3 Mini App:

- Replace the static Mini App with a routed Telegram-native app.
- Add `/home`, `/chat`, `/models`, `/assistants`, `/groups`, `/guard`, `/secretary`, `/usage`, `/payments`, `/settings`, `/admin`, and admin subroutes.
- Wire every control to real backend APIs with initData validation, RBAC, CSRF/replay protection, and audit logging.

Phase 4 Telegram modes and moderation:

- Implement real inline AI with billing/rate limits.
- Implement group moderation commands and Mini App controls.
- Implement guard queues, join-request rules, verification flows, and logs.
- Implement threaded context isolation.
- Add secretary features only for permitted chats/business data.
- Add bot-to-bot loop detection, allowlists, cooldowns, and kill switch.

Phase 5 billing, analytics, and deployment:

- Expand billing ledger to configurable per-feature/per-model pricing.
- Add analytics dashboards and operational health checks.
- Add integration tests for Telegram permissions, Stars idempotency, Mini App auth, group moderation, and provider failures.
- Deploy only after migrations and smoke tests pass.

## Immediate Blockers Before Feature Expansion

1. Rotate exposed credentials.
2. Preserve or upgrade Render PostgreSQL before expiration.
3. Patch Node runtime.
4. Add Mini App freshness/replay protection before adding admin write APIs.
5. Fix chat/thread/user isolation before adding group and threaded AI features.
6. Add current Telegram group-admin verification before implementing moderation actions.

## Milestone 1 Implementation - 2026-07-14

The five selected security findings from this audit are now remediated in the implementation branch.

- Telegram AI conversation identity is isolated by chat, forum topic, and user. Model preferences and in-flight locks use the same scope, and `/reset` clears only that scoped conversation.
- Guard callbacks require Guard Mode to be enabled, the configured platform administrator to still be a current group administrator with invite-user permission, and the bot to currently hold the same required permission. Automatic banned-user declines also fail closed when bot permission cannot be verified.
- Public JSON routes enforce route-specific request budgets and body-size limits before parsing where possible. Telegram webhook authentication remains before body parsing. Render now uses Node `22.22.2`.
- Telegram Mini App launch data must have a valid HMAC, a recent `auth_date`, and a previously unused launch fingerprint. A successful launch is exchanged for a signed, expiring Telegram WebApp session token used by later API calls.
- `/api/chat` now requires that Telegram session. Every non-unlimited request reserves one durable Star credit, reserves capacity from a PostgreSQL-backed NVIDIA hourly budget, and restores the credit on provider failure or disconnect. Per-user and global concurrency limits plus a provider circuit breaker protect the NVIDIA account.

Database addition:

- `ai_provider_usage_buckets` stores atomic per-provider time-window usage counters. The migration is additive and uses `CREATE TABLE IF NOT EXISTS`; no existing table or user data is removed.

Verification:

- Syntax checks passed for all changed server modules.
- Focused security suite: 50 passed, 0 failed.
- Full repository suite: 59 passed, 0 failed.
- Render dependency audit: 0 known vulnerabilities.
- Render runtime-only deploy confirmed Node `22.22.2` before the application-code deployment.
