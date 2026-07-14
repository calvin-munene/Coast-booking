import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  configureTelegramBot,
  handleTelegram,
  splitTelegramText,
  telegramApi,
  telegramPublicStatus,
  validMetaSignature
} from "../src/channels.js";

const originalFetch = global.fetch;
const ENV_NAMES = [
  "META_APP_SECRET",
  "NVIDIA_API_KEY",
  "NVIDIA_BASE_URL",
  "NVIDIA_MODEL",
  "NVIDIA_MODELS",
  "PUBLIC_URL",
  "RENDER_EXTERNAL_URL",
  "TELEGRAM_ALLOWED_USER_IDS",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_WEBHOOK_SECRET"
];
const originalEnvironment = Object.fromEntries(ENV_NAMES.map((name) => [name, process.env[name]]));

function restoreEnvironment() {
  for (const [name, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  global.fetch = originalFetch;
}

test.afterEach(restoreEnvironment);

function telegramSuccess(result = true) {
  return new Response(JSON.stringify({ ok: true, result }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

function telegramUpdate({ text, userId = 123, chatId = 456, type = "private", messageId = 7, updateId = 9 }) {
  return {
    update_id: updateId,
    message: {
      message_id: messageId,
      from: { id: userId, first_name: "Ada" },
      chat: { id: chatId, type },
      text
    }
  };
}

test("validates Meta webhook signatures", () => {
  process.env.META_APP_SECRET = "test-secret";
  const body = Buffer.from('{"ok":true}');
  const signature = `sha256=${crypto.createHmac("sha256", "test-secret").update(body).digest("hex")}`;
  assert.equal(validMetaSignature(body, signature), true);
  assert.equal(validMetaSignature(body, "sha256=bad"), false);
});

test("splits Telegram text without breaking Unicode code points", () => {
  const text = "😀".repeat(4001);
  const chunks = splitTelegramText(text);
  assert.deepEqual(chunks.map((chunk) => Array.from(chunk).length), [4000, 1]);
  assert.equal(chunks.join(""), text);
  assert.equal(chunks.some((chunk) => chunk.includes("�")), false);
});

test("Telegram API helper retries a 429 once using retry_after", async () => {
  process.env.TELEGRAM_BOT_TOKEN = "123:test-token";
  let requests = 0;
  global.fetch = async () => {
    requests += 1;
    if (requests === 1) {
      return new Response(JSON.stringify({
        ok: false,
        error_code: 429,
        description: "Too Many Requests",
        parameters: { retry_after: 0 }
      }), { status: 429, headers: { "content-type": "application/json" } });
    }
    return telegramSuccess({ id: 1, username: "nvidbot" });
  };

  const result = await telegramApi("getMe");
  assert.equal(requests, 2);
  assert.equal(result.username, "nvidbot");
});

test("configures Telegram commands and a protected Render webhook", async () => {
  process.env.TELEGRAM_BOT_TOKEN = "123:test-token";
  process.env.TELEGRAM_WEBHOOK_SECRET = "valid_secret-123";
  process.env.PUBLIC_URL = "https://nvidbot.onrender.com/";
  const calls = [];
  global.fetch = async (url, options) => {
    const method = new URL(url).pathname.split("/").at(-1);
    const payload = JSON.parse(options.body);
    calls.push({ method, payload });
    if (method === "getMe") return telegramSuccess({ id: 101, is_bot: true, first_name: "NvidBot", username: "NvidBotAI" });
    if (method === "getWebhookInfo") {
      return telegramSuccess({ url: "https://nvidbot.onrender.com/webhooks/telegram", pending_update_count: 0 });
    }
    return telegramSuccess(true);
  };

  const status = await configureTelegramBot();
  assert.deepEqual(calls.map(({ method }) => method), ["getMe", "setMyCommands", "setWebhook", "getWebhookInfo"]);
  assert.deepEqual(calls[1].payload.commands.map(({ command }) => command), ["start", "help", "models", "model", "reset", "whoami"]);
  assert.deepEqual(calls[2].payload, {
    url: "https://nvidbot.onrender.com/webhooks/telegram",
    secret_token: "valid_secret-123",
    allowed_updates: ["message"],
    max_connections: 10
  });
  assert.equal(status.configured, true);
  assert.equal(status.username, "NvidBotAI");
  assert.equal(status.link, "https://t.me/NvidBotAI");
  assert.deepEqual(telegramPublicStatus(), status);
});

test("rejects an invalid Telegram webhook secret before making API calls", async () => {
  process.env.TELEGRAM_BOT_TOKEN = "123:test-token";
  process.env.TELEGRAM_WEBHOOK_SECRET = "not valid!";
  process.env.PUBLIC_URL = "https://nvidbot.onrender.com";
  let called = false;
  global.fetch = async () => {
    called = true;
    return telegramSuccess();
  };

  await assert.rejects(configureTelegramBot(), /1-256 letters/);
  assert.equal(called, false);
  assert.equal(telegramPublicStatus().configured, false);
});

test("lets a blocked user run whoami for allowlist discovery", async () => {
  process.env.TELEGRAM_BOT_TOKEN = "123:test-token";
  process.env.TELEGRAM_ALLOWED_USER_IDS = "999";
  const payloads = [];
  global.fetch = async (_url, options) => {
    payloads.push(JSON.parse(options.body));
    return telegramSuccess();
  };

  await handleTelegram(telegramUpdate({ text: "/whoami", userId: 123, chatId: 456 }));
  assert.equal(payloads.length, 1);
  assert.match(payloads[0].text, /User ID: 123/);
  assert.match(payloads[0].text, /Chat ID: 456/);
  assert.deepEqual(payloads[0].reply_parameters, { message_id: 7, allow_sending_without_reply: true });
});

test("blocks normal messages from users outside the optional allowlist", async () => {
  process.env.TELEGRAM_BOT_TOKEN = "123:test-token";
  process.env.TELEGRAM_ALLOWED_USER_IDS = "999";
  const payloads = [];
  global.fetch = async (_url, options) => {
    payloads.push(JSON.parse(options.body));
    return telegramSuccess();
  };

  await handleTelegram(telegramUpdate({ text: "hello", userId: 123, chatId: 457 }));
  assert.equal(payloads.length, 1);
  assert.match(payloads[0].text, /Access denied/);
  assert.match(payloads[0].text, /123/);
});

test("changes and reports the per-chat NVIDIA model by list number", async () => {
  process.env.TELEGRAM_BOT_TOKEN = "123:test-token";
  delete process.env.TELEGRAM_ALLOWED_USER_IDS;
  const sent = [];
  global.fetch = async (url, options) => {
    if (new URL(url).pathname.endsWith("/sendMessage")) sent.push(JSON.parse(options.body));
    return telegramSuccess();
  };

  await handleTelegram(telegramUpdate({ text: "/model 4", chatId: 700 }));
  await handleTelegram(telegramUpdate({ text: "/models", chatId: 700, messageId: 8, updateId: 10 }));

  assert.match(sent[0].text, /Llama 3\.1 8B/);
  assert.match(sent[0].text, /meta\/llama-3\.1-8b-instruct/);
  assert.match(sent[1].text, /meta\/llama-3\.1-8b-instruct  <- active/);
});

test("streams stable Telegram drafts in a private chat and sends a final reply", async () => {
  process.env.TELEGRAM_BOT_TOKEN = "123:test-token";
  process.env.NVIDIA_API_KEY = "nvapi-test";
  delete process.env.TELEGRAM_ALLOWED_USER_IDS;
  const telegramCalls = [];
  global.fetch = async (url, options) => {
    if (new URL(url).hostname === "api.telegram.org") {
      telegramCalls.push({
        method: new URL(url).pathname.split("/").at(-1),
        payload: JSON.parse(options.body)
      });
      return telegramSuccess();
    }
    const stream = [
      'data: {"choices":[{"delta":{"content":"Hello"}}]}',
      "",
      'data: {"choices":[{"delta":{"content":" world"}}]}',
      "",
      "data: [DONE]",
      ""
    ].join("\n");
    return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
  };

  await handleTelegram(telegramUpdate({ text: "Say hello", chatId: 801, messageId: 21, updateId: 31 }));

  const drafts = telegramCalls.filter(({ method }) => method === "sendMessageDraft");
  assert.equal(telegramCalls[0].method, "sendChatAction");
  assert.ok(drafts.length >= 1);
  assert.ok(drafts.every(({ payload }) => payload.draft_id === drafts[0].payload.draft_id));
  assert.notEqual(drafts[0].payload.draft_id, 0);
  assert.equal(drafts.at(-1).payload.text, "Hello world");
  const final = telegramCalls.findLast(({ method }) => method === "sendMessage");
  assert.equal(final.payload.text, "Hello world");
  assert.deepEqual(final.payload.reply_parameters, { message_id: 21, allow_sending_without_reply: true });
});

test("uses typing and a final reply without drafts in a group", async () => {
  process.env.TELEGRAM_BOT_TOKEN = "123:test-token";
  process.env.NVIDIA_API_KEY = "nvapi-test";
  delete process.env.TELEGRAM_ALLOWED_USER_IDS;
  const telegramMethods = [];
  global.fetch = async (url) => {
    if (new URL(url).hostname === "api.telegram.org") {
      telegramMethods.push(new URL(url).pathname.split("/").at(-1));
      return telegramSuccess();
    }
    return new Response('data: {"choices":[{"delta":{"content":"Group answer"}}]}\n\ndata: [DONE]\n\n', {
      status: 200,
      headers: { "content-type": "text/event-stream" }
    });
  };

  await handleTelegram(telegramUpdate({ text: "Question", chatId: -900, type: "supergroup", messageId: 22, updateId: 32 }));

  assert.deepEqual(telegramMethods, ["sendChatAction", "sendMessage"]);
});
