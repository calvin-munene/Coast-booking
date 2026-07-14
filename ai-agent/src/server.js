import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { availableModels, defaultModel, selectModel, streamReply } from "./agent.js";
import {
  configureTelegramBot,
  completeTelegramWebAiUsage,
  handleTelegram,
  handleWhatsApp,
  reserveTelegramWebAiUsage,
  restoreTelegramWebAiUsage,
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

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const port = Number(process.env.PORT || 3000);
const requestRateLimits = new Map();
const webUsersInFlight = new Set();
let activeWebAiRequests = 0;
let providerFailures = [];
let providerCircuitOpenUntil = 0;

function json(res, status, value) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
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

function bearerToken(req) {
  const value = req.headers.authorization;
  const match = typeof value === "string" ? value.match(/^Bearer\s+([^\s]+)$/i) : null;
  return match?.[1] || "";
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

  try {
    await writeSse(res, "meta", { model });
    await streamReply({
      conversationId: `web:${authenticated.userId}:session:${authenticated.sessionId}`,
      text: usage.persona
        ? `User customization:\n${usage.persona}\n\nUser message:\n${message}`
        : message,
      model,
      signal: controller.signal,
      onDelta: (text) => writeSse(res, "delta", { text })
    });
    recordProviderSuccess();
    await writeSse(res, "done", { model });
    responseDelivered = true;
    await completeTelegramWebAiUsage(usage).catch((error) => {
      console.error(`Web AI credit completion failed: ${error.message}`);
    });
  } catch (error) {
    recordProviderFailure(error);
    if (!responseDelivered) {
      await restoreTelegramWebAiUsage(usage).catch((restoreError) => {
        console.error(`Web AI credit restoration failed: ${restoreError.message}`);
      });
    }
    if (!controller.signal.aborted) {
      console.error(`Web AI generation failed: ${error.message}`);
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
    if (req.method === "GET" && url.pathname === "/health") {
      const ok = telegramServiceReady();
      return json(res, ok ? 200 : 503, { ok });
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
      return json(res, 200, {
        verified: true,
        sessionToken: auth.sessionToken,
        dashboard: await telegramDashboardState({ userId: auth.verified.userId })
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
      handleTelegram(data).catch(console.error);
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
      handleWhatsApp(JSON.parse(raw.toString("utf8"))).catch(console.error);
      return json(res, 200, { ok: true });
    }

    if (req.method === "GET") {
      const name = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
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
        res.writeHead(200, { "content-type": types[path.extname(filePath).toLowerCase()] || "application/octet-stream" });
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
    if (!res.headersSent && error?.statusCode === 413) {
      return json(res, 413, { error: "Request body too large" });
    }
    if (res.headersSent) {
      console.error(error);
      if (!res.writableEnded && !res.destroyed) res.end();
      return;
    }
    console.error(error);
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
  const server = createAppServer();
  server.listen(listenPort, () => {
    console.log(`AI agent running at http://localhost:${listenPort}`);
    configureTelegramBot().catch((error) => console.error(`Telegram setup failed: ${error.message}`));
  });
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startAppServer();
}
