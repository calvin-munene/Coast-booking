import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { availableModels, defaultModel, selectModel, streamReply } from "./agent.js";
import {
  configureTelegramBot,
  handleTelegram,
  handleWhatsApp,
  telegramPublicStatus,
  validMetaSignature
} from "./channels.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const port = Number(process.env.PORT || 3000);
const chatRateLimits = new Map();
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_BUDGET = 30;

function json(res, status, value) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(value));
}

async function body(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error("Request body too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function chatClient(req) {
  const forwarded = req.headers["x-forwarded-for"];
  return (Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(",")[0]?.trim()) || req.socket.remoteAddress || "unknown";
}

function consumeChatBudget(req, model) {
  const now = Date.now();
  if (chatRateLimits.size > 1000) {
    for (const [client, bucket] of chatRateLimits) {
      if (bucket.resetAt <= now) chatRateLimits.delete(client);
    }
  }
  const client = chatClient(req);
  const current = chatRateLimits.get(client);
  const bucket = !current || current.resetAt <= now ? { used: 0, resetAt: now + RATE_WINDOW_MS } : current;
  const cost = model === "nvidia/llama-3.3-nemotron-super-49b-v1.5" ? 2 : 1;
  if (bucket.used + cost > RATE_BUDGET) return false;
  bucket.used += cost;
  chatRateLimits.set(client, bucket);
  return true;
}

function validSessionId(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
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

async function streamWebChat(req, res, { sessionId, message, model }) {
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

  try {
    await writeSse(res, "meta", { model });
    await streamReply({
      conversationId: `web:${sessionId}`,
      text: message,
      model,
      signal: controller.signal,
      onDelta: (text) => writeSse(res, "delta", { text })
    });
    await writeSse(res, "done", { model });
  } catch (error) {
    if (!controller.signal.aborted) {
      console.error(error);
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
    if (!res.writableEnded && !res.destroyed) res.end();
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  try {
    if (req.method === "GET" && url.pathname === "/health") return json(res, 200, { ok: true });

    if (req.method === "GET" && url.pathname === "/api/models") {
      return json(res, 200, { models: availableModels(), defaultModel: defaultModel() });
    }

    if (req.method === "GET" && url.pathname === "/api/channels") {
      return json(res, 200, { telegram: telegramPublicStatus() });
    }

    if (req.method === "POST" && url.pathname === "/api/chat") {
      const data = JSON.parse((await body(req)).toString("utf8"));
      if (typeof data.message !== "string" || !data.message.trim() || data.message.length > 8000) {
        return json(res, 400, { error: "Message must contain 1-8000 characters" });
      }
      let model;
      try {
        model = selectModel(data.model);
      } catch (error) {
        return json(res, 400, { error: error.message });
      }
      if (!validSessionId(data.sessionId)) {
        return json(res, 400, { error: "A valid browser session is required" });
      }
      if (!consumeChatBudget(req, model)) {
        return json(res, 429, { error: "Request limit reached. Please try again in a few minutes." });
      }
      return streamWebChat(req, res, { sessionId: data.sessionId, message: data.message.trim(), model });
    }

    if (req.method === "POST" && url.pathname === "/webhooks/telegram") {
      if (!process.env.TELEGRAM_WEBHOOK_SECRET || req.headers["x-telegram-bot-api-secret-token"] !== process.env.TELEGRAM_WEBHOOK_SECRET) {
        return json(res, 401, { error: "Invalid webhook secret" });
      }
      const data = JSON.parse((await body(req)).toString("utf8"));
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
      const raw = await body(req);
      if (!validMetaSignature(raw, req.headers["x-hub-signature-256"])) return json(res, 401, { error: "Invalid signature" });
      handleWhatsApp(JSON.parse(raw.toString("utf8"))).catch(console.error);
      return json(res, 200, { ok: true });
    }

    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/app.js" || url.pathname === "/styles.css" || url.pathname === "/og.png")) {
      const name = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
      const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png" };
      res.writeHead(200, { "content-type": types[path.extname(name)] });
      return res.end(await fs.readFile(path.join(root, name)));
    }
    json(res, 404, { error: "Not found" });
  } catch (error) {
    if (!res.headersSent && error instanceof SyntaxError) {
      return json(res, 400, { error: "Request body must be valid JSON" });
    }
    console.error(error);
    if (res.headersSent) {
      if (!res.writableEnded && !res.destroyed) res.end();
      return;
    }
    const providerUnavailable = [429, 500, 502, 503, 504].includes(error.statusCode);
    json(res, providerUnavailable ? 503 : 500, {
      error: providerUnavailable
        ? "NVIDIA is temporarily busy. Please try again in a moment."
        : "The assistant could not complete that request"
    });
  }
});

server.listen(port, () => {
  console.log(`AI agent running at http://localhost:${port}`);
  configureTelegramBot().catch((error) => console.error(`Telegram setup failed: ${error.message}`));
});
