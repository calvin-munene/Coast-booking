import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import crypto from "node:crypto";
import { createAppServer } from "../src/server.js";
import { setTelegramStarLedgerForTests } from "../src/channels.js";
import { createStarPurchasePayload } from "../src/starPayments.js";
import { resetTelegramWebAuthForTests } from "../src/telegramWebAuth.js";
import { setPlatformStoreForTests } from "../src/platformRuntime.js";

const originalFetch = global.fetch;
const ENV_NAMES = [
  "TELEGRAM_ADMIN_USER_ID",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_STAR_SIGNING_SECRET",
  "TELEGRAM_STARS_REQUIRED",
  "TELEGRAM_WEBHOOK_SECRET",
  "TELEGRAM_WEBAPP_MAX_AGE_SECONDS",
  "TELEGRAM_WEBAPP_SESSION_TTL_SECONDS",
  "NVIDIA_API_KEY",
  "NVIDIA_GLOBAL_REQUESTS_PER_HOUR",
  "NVIDIA_MAX_CONCURRENT_REQUESTS",
  "PUBLIC_URL"
];
const originalEnvironment = Object.fromEntries(ENV_NAMES.map((name) => [name, process.env[name]]));

function restoreEnvironment() {
  for (const [name, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  global.fetch = originalFetch;
  setTelegramStarLedgerForTests(null);
  setPlatformStoreForTests(null);
  resetTelegramWebAuthForTests();
}

test.afterEach(restoreEnvironment);

function enableTelegramPayments() {
  process.env.TELEGRAM_BOT_TOKEN = "123:test-token";
  process.env.TELEGRAM_WEBHOOK_SECRET = "test_webhook_secret";
  process.env.TELEGRAM_STAR_SIGNING_SECRET = "0123456789abcdef0123456789abcdef";
  process.env.TELEGRAM_ADMIN_USER_ID = "6643462826";
  process.env.TELEGRAM_STARS_REQUIRED = "true";
  global.fetch = async () => new Response(JSON.stringify({ ok: true, result: true }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return server.address().port;
}

async function close(server) {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function postTelegram(port, update) {
  const body = JSON.stringify(update);
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: "127.0.0.1",
      port,
      path: "/webhooks/telegram",
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body),
        "x-telegram-bot-api-secret-token": process.env.TELEGRAM_WEBHOOK_SECRET
      }
    }, (response) => {
      response.resume();
      response.once("end", () => resolve({ status: response.statusCode }));
    });
    request.once("error", reject);
    request.end(body);
  });
}

function requestJson(port, path, value, headers = {}) {
  const requestBody = JSON.stringify(value);
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: "127.0.0.1",
      port,
      path,
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(requestBody),
        ...headers
      }
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.once("end", () => resolve({
        status: response.statusCode,
        headers: response.headers,
        text: Buffer.concat(chunks).toString("utf8")
      }));
    });
    request.once("error", reject);
    request.end(requestBody);
  });
}

function requestRaw(port, path, requestBody, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: "127.0.0.1",
      port,
      path,
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(requestBody),
        ...headers
      }
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.once("end", () => resolve({ status: response.statusCode, text: Buffer.concat(chunks).toString("utf8") }));
    });
    request.once("error", reject);
    request.end(requestBody);
  });
}

function requestGet(port, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: "127.0.0.1", port, path, method: "GET", headers }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.once("end", () => resolve({
        status: response.statusCode,
        headers: response.headers,
        text: Buffer.concat(chunks).toString("utf8")
      }));
    });
    request.once("error", reject);
    request.end();
  });
}

function signedInitData({ authDate = Math.floor(Date.now() / 1000), userId = 123 } = {}) {
  const params = new URLSearchParams({
    auth_date: String(authDate),
    query_id: `query-${userId}`,
    user: JSON.stringify({ id: userId, first_name: "Ada" })
  });
  const dataCheckString = [...params.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(process.env.TELEGRAM_BOT_TOKEN).digest();
  params.set("hash", crypto.createHmac("sha256", secret).update(dataCheckString).digest("hex"));
  return params.toString();
}

function webLedgerDouble(overrides = {}) {
  return {
    async getModeSettings(defaultModes) { return { ...defaultModes }; },
    async getUserControl(userId) {
      return { userId: String(userId), banned: false, unlimitedCredits: false, persona: null };
    },
    async getBalance(userId) { return { userId: String(userId), balance: "2" }; },
    async reservePrompt(userId, { reservationId, cost }) {
      return { reserved: true, userId: String(userId), reservationId, cost, state: "reserved", balance: "1" };
    },
    async reserveProviderCapacity() { return { reserved: true, used: 1 }; },
    async completePrompt() {},
    async restorePrompt() {},
    ...overrides
  };
}

function platformStoreDouble(overrides = {}) {
  const features = [{ key: "admin_api", enabled: true, description: "Admin API", config: {}, updatedBy: null }];
  return {
    async ensureUser() {},
    async getUserRole() { return "standard_user"; },
    async writeSecurityEvent() { return { written: true }; },
    async getOverview() { return { totalUsers: "1", activeUsers: "1", newUsers: "1", auditEvents: "0", recentSecurityEvents: "0" }; },
    async listFeatureFlags() { return features; },
    async setFeatureFlag({ featureKey, enabled }) {
      return { duplicate: false, feature: { key: featureKey, enabled, description: "", config: {}, updatedBy: "6643462826" } };
    },
    async listAuditLogs() { return []; },
    async listSecurityEvents() { return []; },
    ...overrides
  };
}

async function launchWebSession(port, userId = 123) {
  const response = await requestJson(port, "/api/miniapp/state", { initData: signedInitData({ userId }) });
  assert.equal(response.status, 200, response.text);
  return JSON.parse(response.text).sessionToken;
}

function paymentUpdate(kind, payload, id = 1) {
  const payment = {
    currency: "XTR",
    total_amount: 5,
    invoice_payload: payload,
    telegram_payment_charge_id: `charge-${kind}-${id}`,
    provider_payment_charge_id: ""
  };
  return {
    update_id: id,
    message: {
      message_id: id,
      from: { id: 123 },
      chat: { id: 123, type: "private" },
      [kind]: payment
    }
  };
}

test("payment webhooks wait for a durable ledger result before returning 200", async () => {
  enableTelegramPayments();
  const payload = createStarPurchasePayload({ userId: 123, amount: 5, nonce: "abcDEF12" });

  for (const kind of ["successful_payment", "refunded_payment"]) {
    const commit = deferred();
    setTelegramStarLedgerForTests({
      async creditPayment() { return commit.promise; },
      async recordRefund() { return commit.promise; }
    });
    const server = createAppServer();
    const port = await listen(server);
    try {
      let settled = false;
      const responsePromise = postTelegram(port, paymentUpdate(kind, payload)).then((response) => {
        settled = true;
        return response;
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.equal(settled, false, `${kind} was acknowledged before its ledger write`);

      commit.resolve(kind === "successful_payment"
        ? { credited: false, balance: "5" }
        : { changed: false, balance: "0", deductedAmount: "0", payment: {} });
      assert.equal((await responsePromise).status, 200);
    } finally {
      await close(server);
    }
  }
});

test("payment webhooks return non-2xx when their ledger write fails", async () => {
  enableTelegramPayments();
  const payload = createStarPurchasePayload({ userId: 123, amount: 5, nonce: "abcDEF12" });
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    for (const kind of ["successful_payment", "refunded_payment"]) {
      setTelegramStarLedgerForTests({
        async creditPayment() { throw new Error("database unavailable"); },
        async recordRefund() { throw new Error("database unavailable"); }
      });
      const server = createAppServer();
      const port = await listen(server);
      try {
        const response = await postTelegram(port, paymentUpdate(kind, payload, 2));
        assert.notEqual(response.status, 200);
      } finally {
        await close(server);
      }
    }
  } finally {
    console.error = originalConsoleError;
  }
});

test("ordinary Telegram messages are acknowledged without waiting for NVIDIA or the ledger", async () => {
  enableTelegramPayments();
  setTelegramStarLedgerForTests({
    async reservePrompt() { return new Promise(() => {}); }
  });
  const server = createAppServer();
  const port = await listen(server);
  try {
    const response = await postTelegram(port, {
      update_id: 3,
      message: {
        message_id: 3,
        from: { id: 123 },
        chat: { id: 999, type: "private" },
        text: "hello"
      }
    });
    assert.equal(response.status, 200);
  } finally {
    await close(server);
  }
});

test("Mini App launch credentials require freshness and cannot be replayed", async () => {
  enableTelegramPayments();
  setTelegramStarLedgerForTests(webLedgerDouble());
  const server = createAppServer();
  const port = await listen(server);
  try {
    const launch = signedInitData();
    assert.equal((await requestJson(port, "/api/miniapp/state", { initData: launch })).status, 200);
    const replay = await requestJson(port, "/api/miniapp/state", { initData: launch });
    assert.equal(replay.status, 401);
    assert.match(replay.text, /already used/i);

    const stale = signedInitData({ authDate: Math.floor(Date.now() / 1000) - 301, userId: 124 });
    assert.equal((await requestJson(port, "/api/miniapp/state", { initData: stale })).status, 401);
  } finally {
    await close(server);
  }
});

test("public chat authenticates before JSON parsing and large public bodies are rejected early", async () => {
  enableTelegramPayments();
  setTelegramStarLedgerForTests(webLedgerDouble());
  const server = createAppServer();
  const port = await listen(server);
  try {
    assert.equal((await requestRaw(port, "/api/chat", "{broken")).status, 401);
    const oversized = JSON.stringify({ initData: "x".repeat(65_000) });
    assert.equal((await requestRaw(port, "/api/miniapp/state", oversized)).status, 413);
  } finally {
    await close(server);
  }
});

test("authenticated web AI uses durable credit and provider budgets exactly once", async () => {
  enableTelegramPayments();
  process.env.NVIDIA_API_KEY = "nvapi-test";
  const reservations = [];
  const providerBudgets = [];
  const completions = [];
  setTelegramStarLedgerForTests(webLedgerDouble({
    async reservePrompt(userId, options) {
      reservations.push({ userId, ...options });
      return { reserved: true, state: "reserved", balance: "1" };
    },
    async reserveProviderCapacity(options) {
      providerBudgets.push(options);
      return { reserved: true, used: 1 };
    },
    async completePrompt(reservationId) { completions.push(reservationId); }
  }));
  global.fetch = async () => new Response(
    'data: {"choices":[{"delta":{"content":"Secure answer"}}]}\n\ndata: [DONE]\n\n',
    { status: 200, headers: { "content-type": "text/event-stream" } }
  );
  const server = createAppServer();
  const port = await listen(server);
  try {
    const session = await launchWebSession(port);
    const requestId = crypto.randomUUID();
    const response = await requestJson(port, "/api/chat", {
      requestId,
      message: "hello",
      model: "meta/llama-3.1-8b-instruct"
    }, { authorization: `Bearer ${session}` });
    assert.equal(response.status, 200, response.text);
    assert.match(response.text, /event: done/);
    assert.deepEqual(reservations, [{ userId: "123", reservationId: `web:123:${requestId}`, cost: 1 }]);
    assert.equal(providerBudgets.length, 1);
    assert.deepEqual(completions, [`web:123:${requestId}`]);
  } finally {
    await close(server);
  }
});

test("web AI does not call NVIDIA without credit and restores credit after provider failure", async () => {
  enableTelegramPayments();
  process.env.NVIDIA_API_KEY = "nvapi-test";
  let nvidiaCalls = 0;
  setTelegramStarLedgerForTests(webLedgerDouble({
    async reservePrompt() { return { reserved: false, state: null, balance: "0" }; }
  }));
  global.fetch = async () => {
    nvidiaCalls += 1;
    return new Response("provider should not be called", { status: 500 });
  };
  let server = createAppServer();
  let port = await listen(server);
  let session;
  try {
    session = await launchWebSession(port);
    const noCredit = await requestJson(port, "/api/chat", {
      requestId: crypto.randomUUID(),
      message: "no credit"
    }, { authorization: `Bearer ${session}` });
    assert.equal(noCredit.status, 402);
    assert.equal(nvidiaCalls, 0);
  } finally {
    await close(server);
  }

  resetTelegramWebAuthForTests();
  const restored = [];
  setTelegramStarLedgerForTests(webLedgerDouble({
    async restorePrompt(reservationId) { restored.push(reservationId); }
  }));
  global.fetch = async () => {
    nvidiaCalls += 1;
    return new Response(JSON.stringify({ error: "unavailable" }), {
      status: 503,
      headers: { "content-type": "application/json" }
    });
  };
  server = createAppServer();
  port = await listen(server);
  try {
    session = await launchWebSession(port);
    const requestId = crypto.randomUUID();
    const failed = await requestJson(port, "/api/chat", {
      requestId,
      message: "provider fails"
    }, { authorization: `Bearer ${session}` });
    assert.equal(failed.status, 200);
    assert.match(failed.text, /event: error/);
    assert.deepEqual(restored, [`web:123:${requestId}`]);
    assert.ok(nvidiaCalls >= 1);
  } finally {
    await close(server);
  }
});

test("admin APIs require a Telegram session and a live platform permission", async () => {
  enableTelegramPayments();
  process.env.PUBLIC_URL = "https://nvidbot.onrender.com";
  setTelegramStarLedgerForTests(webLedgerDouble());
  const securityEvents = [];
  setPlatformStoreForTests(platformStoreDouble({
    async writeSecurityEvent(event) { securityEvents.push(event); return { written: true }; }
  }));
  const server = createAppServer();
  const port = await listen(server);
  try {
    assert.equal((await requestGet(port, "/api/admin/overview")).status, 401);
    const session = await launchWebSession(port, 123);
    const forbidden = await requestGet(port, "/api/admin/overview", { authorization: `Bearer ${session}` });
    assert.equal(forbidden.status, 403, forbidden.text);
    assert.ok(securityEvents.some((event) => event.eventType === "admin_access_denied"));
  } finally {
    await close(server);
  }
});

test("configured super admin can read and idempotently mutate feature controls", async () => {
  enableTelegramPayments();
  process.env.PUBLIC_URL = "https://nvidbot.onrender.com";
  setTelegramStarLedgerForTests(webLedgerDouble({
    async getStats() { return { accounts: "1", credits: "0", payments: "0", prompts: "0" }; }
  }));
  const mutations = [];
  setPlatformStoreForTests(platformStoreDouble({
    async setFeatureFlag(change) {
      mutations.push(change);
      return { duplicate: mutations.length > 1, feature: { key: change.featureKey, enabled: change.enabled } };
    }
  }));
  const server = createAppServer();
  const port = await listen(server);
  try {
    const session = await launchWebSession(port, 6643462826);
    const auth = { authorization: `Bearer ${session}` };
    const features = await requestGet(port, "/api/admin/features", auth);
    assert.equal(features.status, 200, features.text);
    assert.equal(JSON.parse(features.text).features[0].key, "admin_api");

    const requestId = crypto.randomUUID();
    const first = await requestJson(port, "/api/admin/features", {
      requestId,
      featureKey: "group_management",
      enabled: true
    }, { ...auth, origin: process.env.PUBLIC_URL });
    assert.equal(first.status, 200, first.text);
    assert.equal(mutations[0].actorUserId, "6643462826");

    const replay = await requestJson(port, "/api/admin/features", {
      requestId,
      featureKey: "group_management",
      enabled: true
    }, { ...auth, origin: process.env.PUBLIC_URL });
    assert.equal(replay.status, 200, replay.text);
    assert.equal(JSON.parse(replay.text).duplicate, true);

    const forgedOrigin = await requestJson(port, "/api/admin/features", {
      requestId: crypto.randomUUID(),
      featureKey: "group_management",
      enabled: false
    }, { ...auth, origin: "https://attacker.example" });
    assert.equal(forgedOrigin.status, 403, forgedOrigin.text);
  } finally {
    await close(server);
  }
});

test("banned users cannot establish a Mini App session", async () => {
  enableTelegramPayments();
  setTelegramStarLedgerForTests(webLedgerDouble({
    async getUserControl(userId) {
      return { userId: String(userId), banned: true, unlimitedCredits: false, persona: null };
    }
  }));
  setPlatformStoreForTests(platformStoreDouble());
  const server = createAppServer();
  const port = await listen(server);
  try {
    const response = await requestJson(port, "/api/miniapp/state", { initData: signedInitData({ userId: 123 }) });
    assert.equal(response.status, 403, response.text);
    assert.match(response.text, /not permitted/i);
  } finally {
    await close(server);
  }
});
