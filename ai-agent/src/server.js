import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  availableModels,
  defaultModel,
  discoveredNvidiaModels,
  refreshNvidiaModelCatalog,
  selectModel,
  setRuntimeEnabledModels,
  streamReply
} from "./agent.js";
import { runtimeConfig, safeConfigurationStatus, validateRuntimeConfiguration } from "./config.js";
import {
  configureTelegramBot,
  completeTelegramWebAiUsage,
  handleTelegram,
  handleWhatsApp,
  reserveTelegramWebAiUsage,
  restoreTelegramWebAiUsage,
  telegramBillingHistory,
  telegramDashboardState,
  telegramPublicStatus,
  telegramServiceReady,
  telegramUpdateRequiresSynchronousAck,
  validMetaSignature
} from "./channels.js";
import {
  consumeTelegramWebAppInitData,
  issueTelegramWebAppSession,
  verifyTelegramWebAppSession
} from "./telegramWebAuth.js";
import { authorizeHttpRequest, bearerToken } from "./httpAuth.js";
import { logger } from "./logger.js";
import {
  getPlatformStore,
  initializePlatformFoundation,
  platformHealth,
  platformRuntimeStatus
} from "./platformRuntime.js";
import { sourceIdentifierHash } from "./platformStore.js";
import { nvidiaProviderHealth } from "./providerHealth.js";
import { aiChatStarCost, setAiChatStarCost } from "./pricing.js";
import { platformPrincipal } from "./rbac.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const port = Number(process.env.PORT || 3000);
const startedAt = Date.now();
const requestRateLimits = new Map();
const webUsersInFlight = new Set();
let activeWebAiRequests = 0;
let providerFailures = [];
let providerCircuitOpenUntil = 0;

function json(res, status, value) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "permissions-policy": "camera=(), microphone=(), geolocation=()"
  });
  res.end(JSON.stringify(value));
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

async function body(req, { maxBytes = 1_000_000 } = {}) {
  const declaredLength = Number(req.headers["content-length"]);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw httpError(413, "Request body too large");
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw httpError(413, "Request body too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function jsonBody(req, options) {
  const contentType = String(req.headers["content-type"] || "").toLowerCase();
  if (!contentType.startsWith("application/json")) throw httpError(415, "Content-Type must be application/json");
  const raw = await body(req, options);
  return JSON.parse(raw.toString("utf8") || "{}");
}

function chatClient(req) {
  const forwarded = req.headers["x-forwarded-for"];
  return (Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(",")[0]?.trim()) || req.socket.remoteAddress || "unknown";
}

function consumeRequestBudget(req, route, { limit, windowMs, cost = 1 }) {
  const now = Date.now();
  if (requestRateLimits.size > 5000) {
    for (const [key, bucket] of requestRateLimits) {
      if (bucket.resetAt <= now) requestRateLimits.delete(key);
    }
  }
  const key = `${route}:${chatClient(req)}`;
  const current = requestRateLimits.get(key);
  const bucket = !current || current.resetAt <= now ? { used: 0, resetAt: now + windowMs } : current;
  if (bucket.used + cost > limit) return false;
  bucket.used += cost;
  requestRateLimits.set(key, bucket);
  return true;
}

function authenticateTelegramWebRequest(req, data, { allowLaunch = false } = {}) {
  const existing = verifyTelegramWebAppSession(bearerToken(req));
  if (existing) return { verified: existing, sessionToken: null };
  if (!allowLaunch) return { verified: null, sessionToken: null, code: "missing" };
  const launch = consumeTelegramWebAppInitData(data?.initData);
  if (!launch.ok) return { verified: null, sessionToken: null, code: launch.code };
  return {
    verified: launch,
    sessionToken: issueTelegramWebAppSession(launch)
  };
}

async function recordSecurityEvent(req, event) {
  const store = getPlatformStore();
  if (!store?.writeSecurityEvent) return;
  try {
    await store.writeSecurityEvent({
      ...event,
      sourceHash: sourceIdentifierHash(chatClient(req))
    });
  } catch (error) {
    logger.error("security.event.write_failed", { error, eventType: event.eventType });
  }
}

async function authorizeAdminRequest(req, { permission, mutation = false } = {}) {
  const authorization = await authorizeHttpRequest(req, {
    permission,
    mutation,
    store: getPlatformStore(),
    expectedOrigin: runtimeConfig().publicOrigin
  });
  if (!authorization.allowed) {
    await recordSecurityEvent(req, {
      eventType: "admin_access_denied",
      severity: authorization.status === 401 ? "medium" : "high",
      userId: authorization.session?.userId || null,
      metadata: { permission, status: authorization.status }
    });
    return authorization;
  }
  const dashboard = await telegramDashboardState({ userId: authorization.session.userId });
  if (dashboard.banned && !dashboard.isAdmin) {
    await recordSecurityEvent(req, {
      eventType: "banned_user_admin_access",
      severity: "high",
      userId: authorization.session.userId,
      metadata: { permission }
    });
    return { allowed: false, status: 403, error: "This account is banned" };
  }
  return { ...authorization, dashboard };
}

function parseLimit(url) {
  const value = Number(url.searchParams.get("limit") || 50);
  return Number.isSafeInteger(value) && value >= 1 && value <= 250 ? value : 50;
}

async function initializeNvidiaModelControls({ forceRefresh = false } = {}) {
  const catalog = await refreshNvidiaModelCatalog({ force: forceRefresh });
  const store = getPlatformStore();
  if (catalog.refreshed && store?.syncAiModels) await store.syncAiModels(catalog.models);
  if (store?.enabledAiModelIds) {
    const enabled = await store.enabledAiModelIds();
    if (enabled.length) setRuntimeEnabledModels(enabled);
  }
  if (store?.getBillingPrice) {
    const pricing = await store.getBillingPrice("ai_chat");
    if (pricing) setAiChatStarCost(pricing.starCost);
  }
  logger.info("nvidia.model_catalog.ready", {
    refreshed: catalog.refreshed,
    cached: catalog.cached,
    discoveredModels: catalog.models.length,
    enabledModels: availableModels().length
  });
  return catalog;
}

function positiveEnvironmentInteger(name, fallback, minimum, maximum) {
  const parsed = Number(process.env[name] || fallback);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

function providerCircuitIsOpen() {
  return providerCircuitOpenUntil > Date.now();
}

function recordProviderSuccess() {
  providerFailures = [];
  providerCircuitOpenUntil = 0;
}

function recordProviderFailure(error) {
  if (![429, 500, 502, 503, 504].includes(Number(error?.statusCode || 0))) return;
  const now = Date.now();
  providerFailures = providerFailures.filter((timestamp) => now - timestamp < 60_000);
  providerFailures.push(now);
  const threshold = positiveEnvironmentInteger("NVIDIA_CIRCUIT_FAILURE_THRESHOLD", 5, 2, 50);
  if (providerFailures.length >= threshold) {
    providerCircuitOpenUntil = now + positiveEnvironmentInteger("NVIDIA_CIRCUIT_COOLDOWN_SECONDS", 60, 10, 900) * 1000;
  }
}

function acquireWebAiConcurrency(userId) {
  const maximum = positiveEnvironmentInteger("NVIDIA_MAX_CONCURRENT_REQUESTS", 4, 1, 100);
  if (activeWebAiRequests >= maximum || webUsersInFlight.has(userId)) return false;
  activeWebAiRequests += 1;
  webUsersInFlight.add(userId);
  return true;
}

function releaseWebAiConcurrency(userId) {
  webUsersInFlight.delete(userId);
  activeWebAiRequests = Math.max(0, activeWebAiRequests - 1);
}

function streamErrorMessage(error) {
  return [429, 500, 502, 503, 504].includes(error.statusCode)
    ? "NVIDIA is temporarily busy. Please try again in a moment."
    : "The assistant could not complete that request";
}

function writeSse(res, event, data) {
  if (res.destroyed || res.writableEnded) return Promise.reject(new DOMException("Client disconnected", "AbortError"));
  const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  if (res.write(frame)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      res.off("drain", drained);
      res.off("close", closed);
    };
    const drained = () => {
      cleanup();
      resolve();
    };
    const closed = () => {
      cleanup();
      reject(new DOMException("Client disconnected", "AbortError"));
    };
    res.once("drain", drained);
    res.once("close", closed);
  });
}

async function streamWebChat(req, res, { authenticated, usage, message, model }) {
  const controller = new AbortController();
  const abort = () => controller.abort(new DOMException("Client disconnected", "AbortError"));
  const close = () => { if (!res.writableEnded) abort(); };
  req.once("aborted", abort);
  res.once("close", close);
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no"
  });
  res.flushHeaders();
  res.write(": connected\n\n");
  const heartbeat = setInterval(() => {
    if (!res.destroyed && !res.writableEnded) res.write(": heartbeat\n\n");
  }, 15_000);
  let responseDelivered = false;
  let deliveredModel = model;

  try {
    await streamReply({
      conversationId: `web:${authenticated.userId}:session:${authenticated.sessionId}`,
      text: usage.persona
        ? `User customization:\n${usage.persona}\n\nUser message:\n${message}`
        : message,
      model,
      signal: controller.signal,
      onModelSelected: (selectedModel) => {
        deliveredModel = selectedModel;
        return writeSse(res, "meta", { model: selectedModel });
      },
      onDelta: (text) => writeSse(res, "delta", { text })
    });
    recordProviderSuccess();
    await writeSse(res, "done", { model: deliveredModel });
    responseDelivered = true;
    await completeTelegramWebAiUsage(usage).catch((error) => {
      logger.error("web_ai.credit_completion_failed", { error, userId: authenticated.userId });
    });
  } catch (error) {
    recordProviderFailure(error);
    if (!responseDelivered) {
      await restoreTelegramWebAiUsage(usage).catch((restoreError) => {
        logger.error("web_ai.credit_restoration_failed", { error: restoreError, userId: authenticated.userId });
      });
    }
    if (!controller.signal.aborted) {
      logger.error("web_ai.generation_failed", { error, userId: authenticated.userId, model });
      try {
        await writeSse(res, "error", { error: streamErrorMessage(error) });
      } catch {
        // The client disconnected before the safe error event could be sent.
      }
    }
  } finally {
    clearInterval(heartbeat);
    req.off("aborted", abort);
    res.off("close", close);
    releaseWebAiConcurrency(authenticated.userId);
    if (!res.writableEnded && !res.destroyed) res.end();
  }
}

export function createAppServer() {
  return http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  try {
    if (req.method === "GET" && url.pathname === "/health/live") {
      return json(res, 200, { ok: true, uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000) });
    }

    if (req.method === "GET" && ["/health", "/health/ready"].includes(url.pathname)) {
      const database = await platformHealth();
      const telegramReady = telegramServiceReady();
      const ok = telegramReady && database.ok;
      return json(res, ok ? 200 : 503, {
        ok,
        services: {
          telegram: { ok: telegramReady },
          database,
          nvidia: { ok: nvidiaProviderHealth().healthy, status: nvidiaProviderHealth().status }
        },
        deploymentVersion: runtimeConfig().deploymentVersion
      });
    }

    if (req.method === "GET" && url.pathname === "/api/models") {
      return json(res, 200, { models: availableModels(), defaultModel: defaultModel() });
    }

    if (req.method === "GET" && url.pathname === "/api/channels") {
      return json(res, 200, { telegram: telegramPublicStatus() });
    }

    if (req.method === "POST" && url.pathname === "/api/miniapp/state") {
      if (!consumeRequestBudget(req, "miniapp-state", { limit: 60, windowMs: 60_000 })) {
        return json(res, 429, { error: "Request limit reached. Please try again shortly." });
      }
      const data = await jsonBody(req, { maxBytes: 64_000 });
      const auth = authenticateTelegramWebRequest(req, data, { allowLaunch: true });
      if (!auth.verified) {
        return json(res, 401, {
          error: auth.code === "replayed"
            ? "This Telegram launch was already used. Reopen the Mini App to continue."
            : "Fresh Telegram Mini App authentication is required"
        });
      }
      const dashboard = await telegramDashboardState({ userId: auth.verified.userId });
      if (dashboard.banned && !dashboard.isAdmin) {
        await recordSecurityEvent(req, {
          eventType: "banned_user_miniapp_access",
          severity: "medium",
          userId: auth.verified.userId
        });
        return json(res, 403, { error: "This account is not permitted to use Nvid AI" });
      }
      const store = getPlatformStore();
      let principal = null;
      if (store?.ensureUser) {
        await store.ensureUser(auth.verified.userId);
        principal = await platformPrincipal(auth.verified.userId, store);
        if (["banned_user", "restricted_user"].includes(principal?.role)) {
          await recordSecurityEvent(req, {
            eventType: "restricted_platform_user_miniapp_access",
            severity: "medium",
            userId: auth.verified.userId,
            metadata: { role: principal.role }
          });
          return json(res, 403, { error: "This platform account is restricted" });
        }
      }
      return json(res, 200, {
        verified: true,
        sessionToken: auth.sessionToken,
        dashboard: {
          ...dashboard,
          platformRole: principal?.role || (dashboard.isAdmin ? "super_admin" : "standard_user"),
          platformAdmin: ["super_admin", "admin"].includes(principal?.role) || dashboard.isAdmin,
          pricing: { aiChatStarCost: aiChatStarCost() }
        }
      });
    }

    if (req.method === "GET" && url.pathname === "/api/admin/overview") {
      if (!consumeRequestBudget(req, "admin-read", { limit: 120, windowMs: 60_000 })) return json(res, 429, { error: "Request limit reached" });
      const auth = await authorizeAdminRequest(req, { permission: "admin.view" });
      if (!auth.allowed) return json(res, auth.status, { error: auth.error });
      return json(res, 200, {
        overview: await getPlatformStore().getOverview(),
        system: {
          deploymentVersion: runtimeConfig().deploymentVersion,
          uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
          telegram: telegramPublicStatus()
        },
        pricing: { aiChatStarCost: aiChatStarCost() },
        billing: auth.dashboard?.stats || null
      });
    }

    if (req.method === "GET" && url.pathname === "/api/admin/features") {
      if (!consumeRequestBudget(req, "admin-read", { limit: 120, windowMs: 60_000 })) return json(res, 429, { error: "Request limit reached" });
      const auth = await authorizeAdminRequest(req, { permission: "admin.view" });
      if (!auth.allowed) return json(res, auth.status, { error: auth.error });
      return json(res, 200, { features: await getPlatformStore().listFeatureFlags() });
    }

    if (req.method === "GET" && url.pathname === "/api/admin/models") {
      if (!consumeRequestBudget(req, "admin-read", { limit: 120, windowMs: 60_000 })) return json(res, 429, { error: "Request limit reached" });
      const auth = await authorizeAdminRequest(req, { permission: "admin.view" });
      if (!auth.allowed) return json(res, auth.status, { error: auth.error });
      return json(res, 200, {
        models: await getPlatformStore().listAiModels(),
        provider: nvidiaProviderHealth(),
        discovered: discoveredNvidiaModels().length
      });
    }

    if (req.method === "POST" && url.pathname === "/api/admin/models") {
      if (!consumeRequestBudget(req, "admin-write", { limit: 30, windowMs: 60_000 })) return json(res, 429, { error: "Request limit reached" });
      const auth = await authorizeAdminRequest(req, { permission: "models.manage", mutation: true });
      if (!auth.allowed) return json(res, auth.status, { error: auth.error });
      const data = await jsonBody(req, { maxBytes: 16_000 });
      if (typeof data.modelId !== "string" || typeof data.requestId !== "string") {
        return json(res, 400, { error: "modelId and requestId are required" });
      }
      const changed = await getPlatformStore().setAiModelControl({
        actorUserId: auth.principal.userId,
        modelId: data.modelId,
        enabled: data.enabled,
        featured: data.featured,
        label: data.label,
        description: data.description,
        requestId: data.requestId
      });
      const enabled = await getPlatformStore().enabledAiModelIds();
      setRuntimeEnabledModels(enabled);
      return json(res, 200, changed);
    }

    if (req.method === "GET" && url.pathname === "/api/admin/pricing") {
      if (!consumeRequestBudget(req, "admin-read", { limit: 120, windowMs: 60_000 })) return json(res, 429, { error: "Request limit reached" });
      const auth = await authorizeAdminRequest(req, { permission: "billing.view" });
      if (!auth.allowed) return json(res, auth.status, { error: auth.error });
      return json(res, 200, { prices: await getPlatformStore().getBillingPrices() });
    }

    if (req.method === "POST" && url.pathname === "/api/admin/pricing") {
      if (!consumeRequestBudget(req, "admin-write", { limit: 30, windowMs: 60_000 })) return json(res, 429, { error: "Request limit reached" });
      const auth = await authorizeAdminRequest(req, { permission: "billing.manage", mutation: true });
      if (!auth.allowed) return json(res, auth.status, { error: auth.error });
      const data = await jsonBody(req, { maxBytes: 16_000 });
      if (data.featureKey !== "ai_chat"
          || !Number.isSafeInteger(data.starCost)
          || data.starCost < 1
          || data.starCost > 10_000
          || typeof data.requestId !== "string") {
        return json(res, 400, { error: "Valid featureKey, starCost, and requestId are required" });
      }
      const changed = await getPlatformStore().setBillingPrice({
        actorUserId: auth.principal.userId,
        featureKey: data.featureKey,
        starCost: data.starCost,
        requestId: data.requestId
      });
      setAiChatStarCost(changed.price.starCost);
      return json(res, 200, changed);
    }

    if (req.method === "POST" && url.pathname === "/api/admin/features") {
      if (!consumeRequestBudget(req, "admin-write", { limit: 30, windowMs: 60_000 })) return json(res, 429, { error: "Request limit reached" });
      const auth = await authorizeAdminRequest(req, { permission: "features.manage", mutation: true });
      if (!auth.allowed) return json(res, auth.status, { error: auth.error });
      const data = await jsonBody(req, { maxBytes: 16_000 });
      if (typeof data.featureKey !== "string" || typeof data.enabled !== "boolean" || typeof data.requestId !== "string") {
        return json(res, 400, { error: "featureKey, enabled, and requestId are required" });
      }
      const changed = await getPlatformStore().setFeatureFlag({
        actorUserId: auth.principal.userId,
        featureKey: data.featureKey,
        enabled: data.enabled,
        requestId: data.requestId
      });
      return json(res, 200, changed);
    }

    if (req.method === "GET" && url.pathname === "/api/admin/logs") {
      if (!consumeRequestBudget(req, "admin-read", { limit: 120, windowMs: 60_000 })) return json(res, 429, { error: "Request limit reached" });
      const auth = await authorizeAdminRequest(req, { permission: "logs.view" });
      if (!auth.allowed) return json(res, auth.status, { error: auth.error });
      return json(res, 200, { logs: await getPlatformStore().listAuditLogs({ limit: parseLimit(url) }) });
    }

    if (req.method === "GET" && url.pathname === "/api/admin/security-events") {
      if (!consumeRequestBudget(req, "admin-read", { limit: 120, windowMs: 60_000 })) return json(res, 429, { error: "Request limit reached" });
      const auth = await authorizeAdminRequest(req, { permission: "security_events.view" });
      if (!auth.allowed) return json(res, auth.status, { error: auth.error });
      return json(res, 200, { events: await getPlatformStore().listSecurityEvents({ limit: parseLimit(url) }) });
    }

    if (req.method === "GET" && url.pathname === "/api/admin/system") {
      if (!consumeRequestBudget(req, "admin-read", { limit: 120, windowMs: 60_000 })) return json(res, 429, { error: "Request limit reached" });
      const auth = await authorizeAdminRequest(req, { permission: "admin.view" });
      if (!auth.allowed) return json(res, auth.status, { error: auth.error });
      return json(res, 200, {
        configuration: safeConfigurationStatus(),
        platform: platformRuntimeStatus(),
        telegram: telegramPublicStatus(),
        nvidia: { ...nvidiaProviderHealth(), circuitOpen: providerCircuitIsOpen(), activeRequests: activeWebAiRequests },
        uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000)
      });
    }

    if (req.method === "POST" && url.pathname === "/api/chat") {
      const authenticated = verifyTelegramWebAppSession(bearerToken(req));
      if (!authenticated) return json(res, 401, { error: "Open NvidBot inside Telegram to use AI chat" });
      if (!consumeRequestBudget(req, "web-chat", { limit: 30, windowMs: 10 * 60_000 })) {
        return json(res, 429, { error: "Request limit reached. Please try again in a few minutes." });
      }
      if (providerCircuitIsOpen()) {
        return json(res, 503, { error: "NVIDIA is temporarily paused after repeated provider failures" });
      }
      const data = await jsonBody(req, { maxBytes: 32_000 });
      if (typeof data.message !== "string" || !data.message.trim() || data.message.length > 8000) {
        return json(res, 400, { error: "Message must contain 1-8000 characters" });
      }
      let model;
      try {
        model = selectModel(data.model);
      } catch (error) {
        return json(res, 400, { error: error.message });
      }
      if (!acquireWebAiConcurrency(authenticated.userId)) {
        return json(res, 429, { error: "An AI response is already running or the service is at capacity" });
      }
      let usage;
      try {
        usage = await reserveTelegramWebAiUsage({
          userId: authenticated.userId,
          requestId: data.requestId,
          model
        });
      } catch (error) {
        releaseWebAiConcurrency(authenticated.userId);
        throw error;
      }
      if (!usage.allowed) {
        releaseWebAiConcurrency(authenticated.userId);
        return json(res, usage.status, { error: usage.error });
      }
      return streamWebChat(req, res, {
        authenticated,
        usage,
        message: data.message.trim(),
        model
      });
    }

    if (req.method === "GET" && url.pathname === "/api/billing/history") {
      const authenticated = verifyTelegramWebAppSession(bearerToken(req));
      if (!authenticated) return json(res, 401, { error: "Fresh Telegram authentication is required" });
      if (!consumeRequestBudget(req, "billing-history", { limit: 60, windowMs: 60_000 })) return json(res, 429, { error: "Request limit reached" });
      const dashboard = await telegramDashboardState({ userId: authenticated.userId });
      if (dashboard.banned && !dashboard.isAdmin) return json(res, 403, { error: "This account is banned" });
      return json(res, 200, await telegramBillingHistory({ userId: authenticated.userId, limit: parseLimit(url) }));
    }

    if (req.method === "GET" && ["/api/admin/payments", "/api/admin/usage"].includes(url.pathname)) {
      if (!consumeRequestBudget(req, "admin-read", { limit: 120, windowMs: 60_000 })) return json(res, 429, { error: "Request limit reached" });
      const auth = await authorizeAdminRequest(req, { permission: "billing.view" });
      if (!auth.allowed) return json(res, auth.status, { error: auth.error });
      const userId = url.searchParams.get("userId");
      if (userId && !/^[1-9]\d*$/.test(userId)) return json(res, 400, { error: "userId must be a Telegram user ID" });
      const history = await telegramBillingHistory({ userId: userId || null, limit: parseLimit(url) });
      return json(res, 200, url.pathname.endsWith("/payments") ? { payments: history.payments } : { usage: history.usage });
    }

    if (req.method === "POST" && url.pathname === "/webhooks/telegram") {
      if (!process.env.TELEGRAM_WEBHOOK_SECRET || req.headers["x-telegram-bot-api-secret-token"] !== process.env.TELEGRAM_WEBHOOK_SECRET) {
        return json(res, 401, { error: "Invalid webhook secret" });
      }
      if (!consumeRequestBudget(req, "telegram-webhook", { limit: 600, windowMs: 60_000 })) {
        return json(res, 429, { error: "Webhook request limit reached" });
      }
      const data = await jsonBody(req, { maxBytes: 1_000_000 });
      if (telegramUpdateRequiresSynchronousAck(data)) {
        await handleTelegram(data);
        return json(res, 200, { ok: true });
      }
      handleTelegram(data).catch((error) => logger.error("telegram.update_failed", { error, updateId: data?.update_id }));
      return json(res, 200, { ok: true });
    }

    if (req.method === "GET" && url.pathname === "/webhooks/whatsapp") {
      if (url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === process.env.WHATSAPP_VERIFY_TOKEN) {
        res.writeHead(200, { "content-type": "text/plain" });
        return res.end(url.searchParams.get("hub.challenge"));
      }
      return json(res, 403, { error: "Verification failed" });
    }

    if (req.method === "POST" && url.pathname === "/webhooks/whatsapp") {
      if (!consumeRequestBudget(req, "whatsapp-webhook", { limit: 600, windowMs: 60_000 })) {
        return json(res, 429, { error: "Webhook request limit reached" });
      }
      const raw = await body(req, { maxBytes: 1_000_000 });
      if (!validMetaSignature(raw, req.headers["x-hub-signature-256"])) return json(res, 401, { error: "Invalid signature" });
      handleWhatsApp(JSON.parse(raw.toString("utf8"))).catch((error) => logger.error("whatsapp.update_failed", { error }));
      return json(res, 200, { ok: true });
    }

    if (req.method === "GET") {
      const miniAppRoute = /^\/(home|chat|models|assistants|groups|moderation|bots|guard|secretary|threads|usage|history|payments|settings|help|admin(?:\/.*)?|group\/[^/]+)\/?$/.test(url.pathname);
      const name = url.pathname === "/" ? "index.html" : miniAppRoute ? "miniapp.html" : decodeURIComponent(url.pathname.slice(1));
      const filePath = path.normalize(path.join(root, name));
      if (!filePath.startsWith(root + path.sep) && filePath !== root) return json(res, 404, { error: "Not found" });
      const types = {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".svg": "image/svg+xml; charset=utf-8"
      };
      try {
        const content = await fs.readFile(filePath);
        res.writeHead(200, {
          "content-type": types[path.extname(filePath).toLowerCase()] || "application/octet-stream",
          "x-content-type-options": "nosniff",
          "referrer-policy": "strict-origin-when-cross-origin",
          "permissions-policy": "camera=(), microphone=(), geolocation=()",
          "content-security-policy": "default-src 'self'; script-src 'self' https://telegram.org; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'self' https://web.telegram.org https://*.telegram.org"
        });
        return res.end(content);
      } catch (error) {
        if (error?.code !== "ENOENT" && error?.code !== "EISDIR") throw error;
      }
    }
    json(res, 404, { error: "Not found" });
  } catch (error) {
    if (!res.headersSent && error instanceof SyntaxError) {
      return json(res, 400, { error: "Request body must be valid JSON" });
    }
    if (!res.headersSent && [413, 415].includes(error?.statusCode)) {
      return json(res, error.statusCode, { error: error.message });
    }
    if (!res.headersSent && error instanceof TypeError) {
      logger.warn("http.request_validation_failed", { error, method: req.method, path: url.pathname });
      return json(res, 400, { error: "Invalid request parameters" });
    }
    if (res.headersSent) {
      logger.error("http.request_failed_after_headers", { error, method: req.method, path: url.pathname });
      if (!res.writableEnded && !res.destroyed) res.end();
      return;
    }
    logger.error("http.request_failed", { error, method: req.method, path: url.pathname });
    if (Number(error?.statusCode) >= 400 && Number(error?.statusCode) < 500) {
      return json(res, Number(error.statusCode), { error: error.message });
    }
    const providerUnavailable = [429, 500, 502, 503, 504].includes(error.statusCode);
    json(res, providerUnavailable ? 503 : 500, {
      error: providerUnavailable
        ? "NVIDIA is temporarily busy. Please try again in a moment."
        : "The assistant could not complete that request"
    });
  }
  });
}

export function startAppServer(listenPort = port) {
  const config = validateRuntimeConfiguration();
  const server = createAppServer();
  server.listen(listenPort, () => {
    logger.info("application.listening", { port: listenPort, environment: config.environment, deploymentVersion: config.deploymentVersion });
    initializePlatformFoundation()
      .then(() => initializeNvidiaModelControls())
      .catch((error) => logger.error("platform.startup_initialization_failed", { error }));
    configureTelegramBot().catch((error) => logger.error("telegram.setup_failed", { error }));
  });
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startAppServer();
}
