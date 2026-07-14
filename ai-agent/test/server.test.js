import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createAppServer } from "../src/server.js";
import { setTelegramStarLedgerForTests } from "../src/channels.js";
import { createStarPurchasePayload } from "../src/starPayments.js";

const originalFetch = global.fetch;
const ENV_NAMES = [
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
