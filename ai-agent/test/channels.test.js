import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createStarPurchasePayload } from "../src/starPayments.js";
import {
  configureTelegramBot,
  handleTelegramPreCheckout,
  handleTelegram,
  setTelegramStarLedgerForTests,
  splitTelegramText,
  telegramApi,
  telegramPublicStatus,
  telegramServiceReady,
  telegramUpdateRequiresSynchronousAck,
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
  "DATABASE_URL",
  "TELEGRAM_ALLOWED_USER_IDS",
  "TELEGRAM_ADMIN_USER_ID",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_STAR_SIGNING_SECRET",
  "TELEGRAM_STARS_REQUIRED",
  "TELEGRAM_WEBHOOK_SECRET"
];
const originalEnvironment = Object.fromEntries(ENV_NAMES.map((name) => [name, process.env[name]]));

function restoreEnvironment() {
  for (const [name, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  global.fetch = originalFetch;
  setTelegramStarLedgerForTests(null);
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

function starLedgerDouble(overrides = {}) {
  return {
    async init() {},
    async acceptTerms() {},
    async hasAcceptedTerms() { return true; },
    async creditPayment({ userId, amount }) { return { credited: true, userId: String(userId), amount, balance: String(amount) }; },
    async recordRefund() { return { changed: false, balance: null, deductedAmount: "0", payment: null }; },
    async getBalance(userId) { return { userId: String(userId), balance: "0" }; },
    async reservePrompt(userId, { reservationId, cost }) {
      return { reserved: false, changed: false, userId: String(userId), reservationId, cost, state: null, balance: "0" };
    },
    async completePrompt() {},
    async restorePrompt() {},
    async refundStaleReservations() { return { restoredCount: 0, refundedAmount: "0" }; },
    async getStats() { return { totalBalance: "0", paymentCount: "0", completedPrompts: "0" }; },
    async getModeSettings(defaultModes) { return { ...defaultModes }; },
    async setModeEnabled(mode, enabled) { return { mode, enabled, updatedAt: new Date() }; },
    async getUserControl(userId) { return { userId: String(userId), banned: false, banReason: null, unlimitedCredits: false, persona: null }; },
    async setUserBan(userId, banned, reason) { return { userId: String(userId), banned, banReason: reason, unlimitedCredits: false, persona: null }; },
    async setUserPersona(userId, persona) { return { userId: String(userId), banned: false, banReason: null, unlimitedCredits: false, persona }; },
    ...overrides
  };
}

function enableStarTestEnvironment() {
  process.env.TELEGRAM_BOT_TOKEN = "123:test-token";
  process.env.TELEGRAM_STARS_REQUIRED = "true";
  process.env.TELEGRAM_ADMIN_USER_ID = "6643462826";
  process.env.TELEGRAM_STAR_SIGNING_SECRET = "0123456789abcdef0123456789abcdef";
  delete process.env.TELEGRAM_ALLOWED_USER_IDS;
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

test("Telegram API helper does not retry past a shared deadline", async () => {
  process.env.TELEGRAM_BOT_TOKEN = "123:test-token";
  let requests = 0;
  global.fetch = async () => {
    requests += 1;
    return new Response(JSON.stringify({
      ok: false,
      error_code: 429,
      description: "Too Many Requests",
      parameters: { retry_after: 10 }
    }), { status: 429, headers: { "content-type": "application/json" } });
  };

  const startedAt = Date.now();
  await assert.rejects(
    telegramApi("answerPreCheckoutQuery", {}, { deadlineAt: Date.now() + 50 }),
    /429/
  );
  assert.equal(requests, 1);
  assert.ok(Date.now() - startedAt < 500);
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
  assert.deepEqual(calls.map(({ method }) => method), [
    "getMe",
    "setMyShortDescription",
    "setMyDescription",
    "setChatMenuButton",
    "setMyCommands",
    "setWebhook",
    "getWebhookInfo"
  ]);
  assert.equal(
    calls[1].payload.short_description,
    "Hacker-style NVIDIA AI assistant for code, strategy, and fast answers."
  );
  assert.match(calls[2].payload.description, /NvidBot is a hacker-style AI assistant powered by NVIDIA models\./);
  assert.equal(calls[3].payload.menu_button.web_app.url, "https://nvidbot.onrender.com/miniapp.html");
  assert.deepEqual(calls[4].payload.commands.map(({ command }) => command), [
    "start", "help", "dashboard", "modes", "mode", "persona", "models", "model", "reset", "balance", "topup", "terms", "paysupport", "ban", "unban", "starbalance", "whoami"
  ]);
  assert.deepEqual(calls[5].payload, {
    url: "https://nvidbot.onrender.com/webhooks/telegram",
    secret_token: "valid_secret-123",
    allowed_updates: ["message", "pre_checkout_query", "callback_query", "inline_query", "chat_join_request"],
    max_connections: 10
  });
  assert.equal(status.configured, true);
  assert.equal(status.username, "NvidBotAI");
  assert.equal(status.link, "https://t.me/NvidBotAI");
  assert.deepEqual(telegramPublicStatus(), status);
});

test("start sends the welcome image with setup guidance", async () => {
  process.env.TELEGRAM_BOT_TOKEN = "123:test-token";
  process.env.PUBLIC_URL = "https://nvidbot.onrender.com";
  delete process.env.TELEGRAM_ALLOWED_USER_IDS;
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({
      method: new URL(url).pathname.split("/").at(-1),
      payload: JSON.parse(options.body)
    });
    return telegramSuccess();
  };

  await handleTelegram(telegramUpdate({ text: "/start", chatId: 555, messageId: 44, updateId: 66 }));

  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "sendPhoto");
  assert.equal(calls[0].payload.photo, "https://nvidbot.onrender.com/telegram/welcome-banner.png");
  assert.match(calls[0].payload.caption, /NvidBot/);
  assert.match(calls[0].payload.caption, /Quick start:/);
  assert.deepEqual(calls[0].payload.reply_parameters, { message_id: 44, allow_sending_without_reply: true });
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

test("admin AI chat does not consume Stars credits", async () => {
  enableStarTestEnvironment();
  process.env.NVIDIA_API_KEY = "nvapi-test";
  let reserved = false;
  setTelegramStarLedgerForTests(starLedgerDouble({
    async reservePrompt() {
      reserved = true;
      return { reserved: false, balance: "0" };
    }
  }));
  const telegramCalls = [];
  global.fetch = async (url, options) => {
    if (new URL(url).hostname === "api.telegram.org") {
      telegramCalls.push(new URL(url).pathname.split("/").at(-1));
      return telegramSuccess();
    }
    return new Response('data: {"choices":[{"delta":{"content":"Admin answer"}}]}\n\ndata: [DONE]\n\n', {
      status: 200,
      headers: { "content-type": "text/event-stream" }
    });
  };

  await handleTelegram(telegramUpdate({ text: "Admin prompt", userId: 6643462826, chatId: 6643462826 }));

  assert.equal(reserved, false);
  assert.ok(telegramCalls.includes("sendMessage"));
});

test("banned users are blocked before AI inference", async () => {
  enableStarTestEnvironment();
  process.env.NVIDIA_API_KEY = "nvapi-test";
  let nvidiaCalled = false;
  setTelegramStarLedgerForTests(starLedgerDouble({
    async getUserControl(userId) {
      return { userId: String(userId), banned: true, banReason: "abuse", unlimitedCredits: false, persona: null };
    }
  }));
  const messages = [];
  global.fetch = async (url, options) => {
    if (new URL(url).hostname !== "api.telegram.org") nvidiaCalled = true;
    else messages.push(JSON.parse(options.body));
    return telegramSuccess();
  };

  await handleTelegram(telegramUpdate({ text: "Blocked prompt", userId: 123, chatId: 123 }));

  assert.equal(nvidiaCalled, false);
  assert.match(messages[0].text, /banned from NvidBot/);
});

test("disabled chat mode stops paid AI inference without charging", async () => {
  enableStarTestEnvironment();
  process.env.NVIDIA_API_KEY = "nvapi-test";
  let reserved = false;
  let nvidiaCalled = false;
  setTelegramStarLedgerForTests(starLedgerDouble({
    async getModeSettings(defaultModes) {
      return { ...defaultModes, chat: false };
    },
    async reservePrompt() {
      reserved = true;
      return { reserved: true, balance: "0" };
    }
  }));
  const messages = [];
  global.fetch = async (url, options) => {
    if (new URL(url).hostname !== "api.telegram.org") nvidiaCalled = true;
    else messages.push(JSON.parse(options.body));
    return telegramSuccess();
  };

  await handleTelegram(telegramUpdate({ text: "Should not run", userId: 123, chatId: 123 }));

  assert.equal(reserved, false);
  assert.equal(nvidiaCalled, false);
  assert.match(messages[0].text, /AI Chat Mode is currently disabled/);
});

test("top-up confirmation records terms acceptance and sends an XTR invoice", async () => {
  enableStarTestEnvironment();
  const accepted = [];
  setTelegramStarLedgerForTests(starLedgerDouble({
    async acceptTerms(userId, version) { accepted.push({ userId, version }); }
  }));
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({
      method: new URL(url).pathname.split("/").at(-1),
      payload: JSON.parse(options.body)
    });
    return telegramSuccess();
  };

  await handleTelegram(telegramUpdate({ text: "/topup 7", userId: 123, chatId: 123 }));
  const offer = calls.find(({ method }) => method === "sendMessage");
  const callbackData = offer.payload.reply_markup.inline_keyboard[0][0].callback_data;
  assert.ok(Buffer.byteLength(callbackData) <= 64);

  await handleTelegram({
    update_id: 10,
    callback_query: {
      id: "callback-1",
      from: { id: 123 },
      data: callbackData,
      message: { message_id: 8, chat: { id: 123, type: "private" } }
    }
  });

  assert.deepEqual(accepted, [{ userId: "123", version: "2026-07-14" }]);
  const invoice = calls.find(({ method }) => method === "sendInvoice").payload;
  assert.equal(invoice.currency, "XTR");
  assert.deepEqual(invoice.prices, [{ label: "7 AI message credits", amount: 7 }]);
  assert.equal("provider_token" in invoice, false);
  assert.match(invoice.start_parameter, /^topup_[a-f0-9]{24}$/);
});

test("validates pre-checkout data and only approves matching accepted purchases", async () => {
  enableStarTestEnvironment();
  setTelegramStarLedgerForTests(starLedgerDouble({ async hasAcceptedTerms() { return true; } }));
  const payload = createStarPurchasePayload({ userId: 123, amount: 5, nonce: "abcDEF12" });
  const answers = [];
  global.fetch = async (url, options) => {
    const method = new URL(url).pathname.split("/").at(-1);
    if (method === "answerPreCheckoutQuery") answers.push(JSON.parse(options.body));
    return telegramSuccess();
  };

  const validUpdate = {
    update_id: 11,
    pre_checkout_query: {
      id: "checkout-good",
      from: { id: 123 },
      currency: "XTR",
      total_amount: 5,
      invoice_payload: payload
    }
  };
  assert.equal(telegramUpdateRequiresSynchronousAck(validUpdate), true);
  await handleTelegram(validUpdate);
  await handleTelegram({
    pre_checkout_query: {
      ...validUpdate.pre_checkout_query,
      id: "checkout-bad",
      total_amount: 4
    }
  });

  assert.deepEqual(answers[0], { pre_checkout_query_id: "checkout-good", ok: true });
  assert.equal(answers[1].ok, false);
  assert.match(answers[1].error_message, /amount/i);
});

test("rejects pre-checkout within the shared deadline when the ledger stalls", async () => {
  enableStarTestEnvironment();
  setTelegramStarLedgerForTests(starLedgerDouble({
    async hasAcceptedTerms() { return new Promise(() => {}); }
  }));
  const payload = createStarPurchasePayload({ userId: 123, amount: 5, nonce: "abcDEF12" });
  const answers = [];
  global.fetch = async (_url, options) => {
    answers.push(JSON.parse(options.body));
    return telegramSuccess();
  };

  const startedAt = Date.now();
  await handleTelegramPreCheckout({
    id: "checkout-stalled",
    from: { id: 123 },
    currency: "XTR",
    total_amount: 5,
    invoice_payload: payload
  }, { deadlineMs: 100, ledgerBudgetMs: 20 });

  assert.ok(Date.now() - startedAt < 500);
  assert.equal(answers.length, 1);
  assert.equal(answers[0].ok, false);
  assert.match(answers[0].error_message, /ledger/i);
});

test("credits each successful Telegram payment once before acknowledging it", async () => {
  enableStarTestEnvironment();
  const credited = [];
  setTelegramStarLedgerForTests(starLedgerDouble({
    async creditPayment(payment) {
      credited.push(payment);
      return { credited: true, balance: "12" };
    }
  }));
  const payload = createStarPurchasePayload({ userId: 123, amount: 12, nonce: "abcDEF12" });
  const telegramMessages = [];
  global.fetch = async (url, options) => {
    const method = new URL(url).pathname.split("/").at(-1);
    if (method === "sendMessage") telegramMessages.push(JSON.parse(options.body));
    return telegramSuccess();
  };
  const update = {
    update_id: 12,
    message: {
      message_id: 20,
      from: { id: 123, username: "ada" },
      chat: { id: 123, type: "private" },
      successful_payment: {
        currency: "XTR",
        total_amount: 12,
        invoice_payload: payload,
        telegram_payment_charge_id: "charge-123",
        provider_payment_charge_id: ""
      }
    }
  };

  assert.equal(telegramUpdateRequiresSynchronousAck(update), true);
  await handleTelegram(update);
  assert.equal(credited.length, 1);
  assert.equal(credited[0].telegramPaymentChargeId, "charge-123");
  assert.match(telegramMessages[0].text, /Current balance: 12/);
  assert.equal(telegramMessages[1].chat_id, "6643462826");
});

test("credits an authentic successful payment even after its invoice payload expires", async () => {
  enableStarTestEnvironment();
  const credited = [];
  setTelegramStarLedgerForTests(starLedgerDouble({
    async creditPayment(payment) {
      credited.push(payment);
      return { credited: true, balance: "3" };
    }
  }));
  const expiredPayload = createStarPurchasePayload({
    userId: 123,
    amount: 3,
    nonce: "abcDEF12",
    now: Date.now() - 8 * 24 * 60 * 60 * 1000
  });
  global.fetch = async () => telegramSuccess();

  await handleTelegram({
    update_id: 120,
    message: {
      message_id: 200,
      from: { id: 123 },
      chat: { id: 123, type: "private" },
      successful_payment: {
        currency: "XTR",
        total_amount: 3,
        invoice_payload: expiredPayload,
        telegram_payment_charge_id: "charge-expired-delivery",
        provider_payment_charge_id: ""
      }
    }
  });

  assert.equal(credited.length, 1);
  assert.equal(credited[0].telegramPaymentChargeId, "charge-expired-delivery");
});

test("paid Telegram mode is not ready until its ledger and webhook are configured", async () => {
  enableStarTestEnvironment();
  process.env.TELEGRAM_WEBHOOK_SECRET = "valid_secret-123";
  process.env.PUBLIC_URL = "https://nvidbot.onrender.com";
  delete process.env.DATABASE_URL;
  await assert.rejects(configureTelegramBot(), /DATABASE_URL/);
  assert.equal(telegramServiceReady(), false);
  assert.equal(telegramPublicStatus().starsRequired, true);
  assert.equal(telegramPublicStatus().starLedgerReady, false);
});

test("reconciles Telegram refund updates against unused credits", async () => {
  enableStarTestEnvironment();
  const refunds = [];
  setTelegramStarLedgerForTests(starLedgerDouble({
    async recordRefund(refund) {
      refunds.push(refund);
      return {
        changed: true,
        balance: "2",
        deductedAmount: "3",
        payment: { telegramPaymentChargeId: refund.telegramPaymentChargeId }
      };
    }
  }));
  const payload = createStarPurchasePayload({ userId: 123, amount: 5, nonce: "abcDEF12" });
  global.fetch = async () => telegramSuccess();
  const update = {
    update_id: 13,
    message: {
      message_id: 21,
      from: { id: 123 },
      chat: { id: 123, type: "private" },
      refunded_payment: {
        currency: "XTR",
        total_amount: 5,
        invoice_payload: payload,
        telegram_payment_charge_id: "charge-refunded"
      }
    }
  };

  await handleTelegram(update);
  assert.deepEqual(refunds, [{
    telegramPaymentChargeId: "charge-refunded",
    userId: "123",
    amount: 5
  }]);
});

test("does not call NVIDIA when a paying user has no message credit", async () => {
  enableStarTestEnvironment();
  setTelegramStarLedgerForTests(starLedgerDouble());
  let nvidiaCalled = false;
  const sent = [];
  global.fetch = async (url, options) => {
    if (new URL(url).hostname !== "api.telegram.org") nvidiaCalled = true;
    else if (new URL(url).pathname.endsWith("/sendMessage")) sent.push(JSON.parse(options.body));
    return telegramSuccess();
  };

  await handleTelegram(telegramUpdate({ text: "Use a paid prompt", userId: 123, chatId: 123 }));
  assert.equal(nvidiaCalled, false);
  assert.match(sent[0].text, /need 1 AI message credit/i);
  assert.match(sent[0].text, /\/topup/);
});

test("restores a reserved credit when NVIDIA generation fails", async () => {
  enableStarTestEnvironment();
  process.env.NVIDIA_API_KEY = "nvapi-test";
  const restored = [];
  let completed = false;
  setTelegramStarLedgerForTests(starLedgerDouble({
    async reservePrompt(userId, { reservationId, cost }) {
      return { reserved: true, changed: true, userId: String(userId), reservationId, cost, state: "reserved", balance: "2" };
    },
    async completePrompt() { completed = true; },
    async restorePrompt(reservationId) { restored.push(reservationId); }
  }));
  global.fetch = async (url) => {
    if (new URL(url).hostname === "api.telegram.org") return telegramSuccess();
    return new Response(JSON.stringify({ error: "bad request" }), {
      status: 400,
      headers: { "content-type": "application/json" }
    });
  };

  await handleTelegram(telegramUpdate({ text: "This will fail", userId: 123, chatId: 123, messageId: 99 }));
  assert.equal(completed, false);
  assert.deepEqual(restored, ["telegram:123:99"]);
});
