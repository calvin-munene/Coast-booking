import crypto from "node:crypto";
import {
  availableModels,
  defaultModel,
  reply,
  resetConversation,
  selectModel,
  streamReply
} from "./agent.js";
import { createStarLedger } from "./starLedger.js";
import {
  MAX_STAR_TOPUP,
  MIN_STAR_TOPUP,
  STAR_TERMS_VERSION,
  createStarPurchasePayload,
  parseStarTopupAmount,
  telegramStarTerms,
  validateStarPurchasePayload
} from "./starPayments.js";

const TELEGRAM_API_ROOT = "https://api.telegram.org";
const TELEGRAM_TEXT_LIMIT = 4000;
const DRAFT_INTERVAL_MS = 900;
const PRE_CHECKOUT_DEADLINE_MS = 8000;
const PRE_CHECKOUT_LEDGER_BUDGET_MS = 4000;
const telegramModelPreferences = new Map();
const telegramChatsInFlight = new Set();
let telegramStatus = Object.freeze({ enabled: false, configured: false });
let telegramStarLedger = null;
let telegramStarSweepTimer = null;
let telegramStarSweepInFlight = false;
const TELEGRAM_BOT_SHORT_DESCRIPTION = "Hacker-style NVIDIA AI assistant for code, strategy, and fast answers.";
const TELEGRAM_BOT_DESCRIPTION = [
  "NvidBot is a hacker-style AI assistant powered by NVIDIA models.",
  "Use it for coding help, debugging, research, planning, content, and technical answers.",
  "On Telegram, each accepted non-command AI prompt costs 1 prepaid credit.",
  "Use /topup to buy credits with Telegram Stars, /models to switch models, and /help for the full command list."
].join(" ");
const TELEGRAM_WELCOME_IMAGE_PATH = "/telegram/welcome-banner.png";

const TELEGRAM_COMMANDS = [
  { command: "start", description: "Start NvidBot" },
  { command: "help", description: "Show available commands" },
  { command: "models", description: "List available NVIDIA models" },
  { command: "model", description: "View or change the active model" },
  { command: "reset", description: "Clear this chat's AI memory" },
  { command: "balance", description: "Show AI message credits" },
  { command: "topup", description: "Buy credits with Telegram Stars" },
  { command: "terms", description: "Read the Stars purchase terms" },
  { command: "paysupport", description: "Get help with a Stars payment" },
  { command: "starbalance", description: "Admin Stars and credit totals" },
  { command: "whoami", description: "Show your Telegram IDs" }
];

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function within(promise, milliseconds, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), milliseconds);
        timer.unref?.();
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function telegramStarsRequired() {
  return /^(1|true|yes|on)$/i.test(process.env.TELEGRAM_STARS_REQUIRED?.trim() || "");
}

function telegramAdminUserId() {
  return process.env.TELEGRAM_ADMIN_USER_ID?.trim() || "";
}

function telegramUserIsAdmin(userId) {
  const adminId = telegramAdminUserId();
  return Boolean(adminId && String(userId ?? "") === adminId);
}

function requireStarLedger() {
  if (!telegramStarLedger) throw new Error("Telegram Stars ledger is not ready");
  return telegramStarLedger;
}

async function reconcileStaleTelegramCredits() {
  if (!telegramStarLedger || telegramStarSweepInFlight) return;
  telegramStarSweepInFlight = true;
  try {
    const restored = await telegramStarLedger.refundStaleReservations();
    if (Number(restored?.restoredCount || 0) > 0) {
      console.log(`Restored ${restored.restoredCount} stale Telegram credit reservation(s)`);
    }
  } finally {
    telegramStarSweepInFlight = false;
  }
}

function startTelegramStarReconciliation() {
  if (telegramStarSweepTimer) return;
  telegramStarSweepTimer = setInterval(() => {
    reconcileStaleTelegramCredits().catch((error) => {
      console.error(`Telegram credit reconciliation failed: ${error.message}`);
    });
  }, 60_000);
  telegramStarSweepTimer.unref?.();
}

async function initializeTelegramStars() {
  if (!telegramStarsRequired()) return false;
  if (!process.env.DATABASE_URL?.trim()) throw new Error("DATABASE_URL is required when Telegram Stars are enabled");
  if (!telegramAdminUserId()) throw new Error("TELEGRAM_ADMIN_USER_ID is required when Telegram Stars are enabled");

  if (!telegramStarLedger) telegramStarLedger = createStarLedger();
  await telegramStarLedger.init();
  await reconcileStaleTelegramCredits();
  startTelegramStarReconciliation();
  return true;
}

/** Test hook for an isolated in-memory ledger double. */
export function setTelegramStarLedgerForTests(ledger) {
  if (telegramStarSweepTimer) clearInterval(telegramStarSweepTimer);
  telegramStarSweepTimer = null;
  telegramStarSweepInFlight = false;
  telegramStarLedger = ledger || null;
}

function telegramToken() {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not configured");
  return token;
}

function telegramApiError(method, response, data) {
  const status = Number(response?.status || data?.error_code || 500);
  const description = typeof data?.description === "string" ? `: ${data.description.slice(0, 240)}` : "";
  const error = new Error(`Telegram ${method} failed (${status})${description}`);
  error.statusCode = status;
  return error;
}

/**
 * Call a Telegram Bot API method without ever placing the bot token in errors.
 * Telegram can return errors in either the HTTP status or an { ok: false }
 * response, so both layers are checked. A rate-limited call is retried once.
 */
export async function telegramApi(method, payload = {}, { deadlineAt } = {}) {
  const token = telegramToken();

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const remaining = deadlineAt === undefined ? 15_000 : Math.floor(deadlineAt - Date.now());
    if (!Number.isFinite(remaining) || remaining <= 0) {
      throw new Error(`Telegram ${method} request deadline expired`);
    }
    let response;
    try {
      response = await fetch(`${TELEGRAM_API_ROOT}/bot${token}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(Math.max(1, Math.min(15_000, remaining)))
      });
    } catch (cause) {
      throw new Error(`Telegram ${method} request failed`, { cause });
    }

    let data;
    try {
      data = await response.json();
    } catch (cause) {
      const error = new Error(`Telegram ${method} returned invalid JSON`, { cause });
      error.statusCode = response.status;
      throw error;
    }

    const rateLimited = response.status === 429 || data?.error_code === 429;
    if (rateLimited && attempt === 0) {
      const retryAfter = Number(data?.parameters?.retry_after);
      const retryDelay = Number.isFinite(retryAfter) && retryAfter >= 0 ? retryAfter * 1000 : 1000;
      if (deadlineAt !== undefined && retryDelay >= deadlineAt - Date.now()) {
        throw telegramApiError(method, response, data);
      }
      await wait(retryDelay);
      continue;
    }

    if (!response.ok || data?.ok !== true) throw telegramApiError(method, response, data);
    return data.result;
  }

  throw new Error(`Telegram ${method} request failed`);
}

function telegramAllowedUserIds() {
  return new Set(
    (process.env.TELEGRAM_ALLOWED_USER_IDS || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  );
}

function telegramUserIsAllowed(message) {
  const allowed = telegramAllowedUserIds();
  return allowed.size === 0 || allowed.has(String(message.from?.id ?? ""));
}

function parseTelegramCommand(text) {
  const match = text.match(/^\/([a-z0-9_]+)(?:@([a-z0-9_]+))?(?:\s+([\s\S]*))?$/i);
  if (!match) return null;
  return { name: match[1].toLowerCase(), botUsername: match[2]?.toLowerCase(), argument: match[3]?.trim() || "" };
}

function conversationId(chatId) {
  return `telegram:${chatId}`;
}

function preferredTelegramModel(chatId) {
  const stored = telegramModelPreferences.get(String(chatId));
  try {
    return selectModel(stored || defaultModel());
  } catch {
    telegramModelPreferences.delete(String(chatId));
    return selectModel(defaultModel());
  }
}

function normalizeModelSearch(value) {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "");
}

function resolveTelegramModel(value) {
  const models = availableModels();
  const query = value.trim();
  if (!query) return { model: null, matches: [] };

  if (/^\d+$/.test(query)) {
    const model = models[Number(query) - 1];
    return { model: model || null, matches: model ? [model] : [] };
  }

  const lower = query.toLocaleLowerCase();
  const normalized = normalizeModelSearch(query);
  const exact = models.find((model) =>
    [model.id, model.label, model.tag].some((candidate) => candidate?.toLocaleLowerCase() === lower)
    || [model.id, model.label, model.tag].some((candidate) => normalizeModelSearch(candidate || "") === normalized)
  );
  if (exact) return { model: exact, matches: [exact] };

  const matches = models.filter((model) =>
    [model.id, model.label, model.tag]
      .map((candidate) => candidate?.toLocaleLowerCase() || "")
      .some((candidate) => candidate.includes(lower) || normalizeModelSearch(candidate).includes(normalized))
  );
  return { model: matches.length === 1 ? matches[0] : null, matches };
}

function modelListText(chatId) {
  const current = preferredTelegramModel(chatId);
  const lines = availableModels().map((model, index) => {
    const selected = model.id === current ? "  <- active" : "";
    return `${index + 1}. ${model.label} [${model.tag}]\n   ${model.id}${selected}`;
  });
  return `Available NVIDIA models:\n\n${lines.join("\n\n")}\n\nChange model with /model <number or model name>.`;
}

function helpText() {
  const lines = [
    "NvidBot commands:",
    "",
    "/models - list available NVIDIA models",
    "/model <number or name> - change the model for this chat",
    "/reset - clear this chat's AI memory",
    "/balance - show your AI message credits",
    `/topup <${MIN_STAR_TOPUP}-${MAX_STAR_TOPUP}> - buy credits with Telegram Stars`,
    "/terms - read the Stars purchase terms",
    "/paysupport <message> - contact payment support",
    "/whoami - show your Telegram user and chat IDs",
    "/help - show this guide"
  ];
  lines.push(
    "",
    telegramStarsRequired()
      ? "Each non-command AI prompt costs 1 message credit. One Telegram Star buys one credit."
      : "Send a message to chat with the active NVIDIA model."
  );
  return lines.join("\n");
}

function welcomeText() {
  const lines = [
    "NvidBot",
    "Hacker-style NVIDIA AI assistant for code, debugging, research, and rapid answers.",
    "",
    "Quick start:",
    "/models - browse available NVIDIA models",
    "/model <number or name> - switch the active model",
    "/reset - clear this chat's memory",
    "/help - show all commands"
  ];
  lines.push(
    "",
    telegramStarsRequired()
      ? "Telegram pricing: each accepted non-command AI prompt costs 1 credit. Use /topup <amount> to buy credits with Telegram Stars."
      : "Send any message to start chatting with the active NVIDIA model."
  );
  return lines.join("\n");
}

function whoAmIText(message) {
  return [
    "Telegram identity:",
    `User ID: ${message.from?.id ?? "unavailable"}`,
    `Chat ID: ${message.chat?.id ?? "unavailable"}`,
    `Chat type: ${message.chat?.type || "unknown"}`
  ].join("\n");
}

/** Split long Telegram messages at code-point boundaries, preferring whitespace. */
export function splitTelegramText(value, limit = TELEGRAM_TEXT_LIMIT) {
  const codePoints = Array.from(String(value || ""));
  if (!codePoints.length) return [];
  const chunks = [];

  while (codePoints.length > limit) {
    let boundary = limit;
    const preferredFloor = Math.floor(limit * 0.7);
    for (let index = limit; index >= preferredFloor; index -= 1) {
      if (/\s/u.test(codePoints[index - 1])) {
        boundary = index;
        break;
      }
    }
    const chunk = codePoints.splice(0, boundary).join("").trim();
    if (chunk) chunks.push(chunk);
    while (codePoints.length && /^\s$/u.test(codePoints[0])) codePoints.shift();
  }

  const remainder = codePoints.join("").trim();
  if (remainder) chunks.push(remainder);
  return chunks;
}

function messageThreadPayload(message) {
  return Number.isInteger(message.message_thread_id) ? { message_thread_id: message.message_thread_id } : {};
}

async function sendTelegramText(message, text) {
  const chunks = splitTelegramText(text);
  for (let index = 0; index < chunks.length; index += 1) {
    await telegramApi("sendMessage", {
      chat_id: message.chat.id,
      text: chunks[index],
      ...messageThreadPayload(message),
      ...(index === 0 && message.message_id
        ? { reply_parameters: { message_id: message.message_id, allow_sending_without_reply: true } }
        : {})
    });
  }
}

async function sendTelegramPhoto(message, photo, caption) {
  await telegramApi("sendPhoto", {
    chat_id: message.chat.id,
    photo,
    caption,
    ...messageThreadPayload(message),
    ...(message.message_id
      ? { reply_parameters: { message_id: message.message_id, allow_sending_without_reply: true } }
      : {})
  });
}

function telegramPublicAssetUrl(pathname) {
  return `${telegramPublicBaseUrl()}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
}

async function sendTelegramWelcome(message) {
  const caption = welcomeText();
  try {
    await sendTelegramPhoto(message, telegramPublicAssetUrl(TELEGRAM_WELCOME_IMAGE_PATH), caption);
  } catch (error) {
    console.error(`Telegram welcome image failed: ${error.message}`);
    await sendTelegramText(message, caption);
  }
}

function balanceValue(result) {
  return String(result?.balance ?? result ?? "0");
}

async function sendTopupOffer(message, amount) {
  if (!telegramStarsRequired()) {
    await sendTelegramText(message, "Telegram Stars purchasing is not enabled for this bot.");
    return;
  }
  requireStarLedger();
  if (message.chat.type !== "private") {
    await sendTelegramText(message, "For payment security, open a private chat with me and run /topup there.");
    return;
  }

  const payload = createStarPurchasePayload({ userId: message.from?.id, amount });
  await telegramApi("sendMessage", {
    chat_id: message.chat.id,
    text: [
      `Buy ${amount} AI message credit${amount === 1 ? "" : "s"} for ${amount} Telegram Star${amount === 1 ? "" : "s"}.`,
      "",
      "One accepted AI prompt costs 1 credit. Commands are free. Read /terms for the full terms.",
      "",
      "Tap the button below to confirm the terms and open Telegram's secure Stars checkout."
    ].join("\n"),
    reply_markup: {
      inline_keyboard: [[{
        text: `I agree - Buy ${amount} Star${amount === 1 ? "" : "s"}`,
        callback_data: payload
      }]]
    },
    ...messageThreadPayload(message),
    ...(message.message_id
      ? { reply_parameters: { message_id: message.message_id, allow_sending_without_reply: true } }
      : {})
  });
}

async function handleStarPurchaseCallback(callback) {
  if (!String(callback?.data || "").startsWith("s1.")) return false;
  const message = callback.message;
  const validation = validateStarPurchasePayload(callback.data, { userId: callback.from?.id });
  if (!telegramStarsRequired() || !telegramStarLedger) {
    await telegramApi("answerCallbackQuery", {
      callback_query_id: callback.id,
      text: "Star payments are temporarily unavailable. Please try again later.",
      show_alert: true
    });
    return true;
  }
  if (!message || message.chat?.type !== "private" || !validation.valid) {
    await telegramApi("answerCallbackQuery", {
      callback_query_id: callback.id,
      text: validation.error || "Open a private chat with the bot to purchase credits.",
      show_alert: true
    });
    return true;
  }

  const { purchase } = validation;
  await telegramStarLedger.acceptTerms(purchase.userId, STAR_TERMS_VERSION);
  await telegramApi("answerCallbackQuery", {
    callback_query_id: callback.id,
    text: "Terms accepted. Opening secure Stars checkout."
  });
  const startParameter = `topup_${crypto.createHash("sha256").update(purchase.payload).digest("hex").slice(0, 24)}`;
  await telegramApi("sendInvoice", {
    chat_id: message.chat.id,
    title: "NvidBot AI credits",
    description: `${purchase.amount} prepaid AI message credit${purchase.amount === 1 ? "" : "s"}. One credit is used per accepted prompt.`,
    payload: purchase.payload,
    currency: "XTR",
    prices: [{
      label: `${purchase.amount} AI message credit${purchase.amount === 1 ? "" : "s"}`,
      amount: purchase.amount
    }],
    start_parameter: startParameter,
    protect_content: true
  });
  return true;
}

async function sendPaymentSupport(message, detail) {
  const adminId = telegramAdminUserId();
  if (!adminId) {
    await sendTelegramText(message, "Payment support is not configured. Please try again later.");
    return;
  }
  if (!detail) {
    await sendTelegramText(
      message,
      `For payment help, run /paysupport followed by a short description and any payment ID.\n\nPayment administrator ID: ${adminId}. Telegram support cannot resolve purchases made from this bot.`
    );
    return;
  }

  const report = [
    "NvidBot payment support request",
    `From user: ${message.from?.id ?? "unknown"}`,
    `Username: ${message.from?.username ? `@${message.from.username}` : "not provided"}`,
    `Chat: ${message.chat?.id ?? "unknown"}`,
    "",
    detail.slice(0, 3000)
  ].join("\n");
  try {
    await telegramApi("sendMessage", { chat_id: adminId, text: report });
    await sendTelegramText(message, "Your payment support request was sent to the bot administrator.");
  } catch {
    await sendTelegramText(
      message,
      `I could not deliver the support request automatically. Contact the bot administrator (Telegram user ID ${adminId}) and include your payment ID.`
    );
  }
}

async function sendAdminStarBalance(message) {
  if (!telegramUserIsAdmin(message.from?.id)) {
    await sendTelegramText(message, "This command is available only to the configured bot administrator.");
    return;
  }
  const [botBalance, stats] = await Promise.all([
    telegramApi("getMyStarBalance"),
    requireStarLedger().getStats()
  ]);
  await sendTelegramText(message, [
    "NvidBot Stars admin status:",
    `Telegram bot balance: ${botBalance?.amount ?? 0} Stars`,
    `Outstanding user credits: ${stats?.outstandingCredits ?? stats?.totalBalance ?? "0"}`,
    `Credited payments: ${stats?.payments ?? stats?.paymentCount ?? "0"}`,
    `Completed paid prompts: ${stats?.completedPrompts ?? "0"}`
  ].join("\n"));
}

function telegramDraftId(update, message) {
  const seed = `${update.update_id ?? "update"}:${message.chat.id}:${message.message_id ?? "message"}`;
  return (crypto.createHash("sha256").update(seed).digest().readUInt32BE(0) & 0x7fffffff) || 1;
}

export async function handleTelegramPreCheckout(query, {
  deadlineMs = PRE_CHECKOUT_DEADLINE_MS,
  ledgerBudgetMs = PRE_CHECKOUT_LEDGER_BUDGET_MS
} = {}) {
  if (!Number.isFinite(deadlineMs) || deadlineMs <= 0 || !Number.isFinite(ledgerBudgetMs) || ledgerBudgetMs <= 0) {
    throw new TypeError("Pre-checkout deadlines must be positive numbers");
  }
  const deadlineAt = Date.now() + Math.floor(deadlineMs);
  const validation = validateStarPurchasePayload(query?.invoice_payload, {
    userId: query?.from?.id,
    currency: query?.currency,
    totalAmount: query?.total_amount
  });
  let error = validation.valid ? null : validation.error;

  if (!telegramStarsRequired() || !telegramStarLedger) {
    error = "Star payments are temporarily unavailable. Please try again later.";
  } else if (!error) {
    try {
      const lookupBudget = Math.max(1, Math.min(
        Math.floor(ledgerBudgetMs),
        deadlineAt - Date.now() - 1000
      ));
      const accepted = await within(
        telegramStarLedger.hasAcceptedTerms(validation.purchase.userId, STAR_TERMS_VERSION),
        lookupBudget,
        "The payment ledger did not respond"
      );
      if (!accepted) error = "Please run /topup again and accept the current purchase terms.";
    } catch {
      error = "The payment ledger is temporarily unavailable. Please try again.";
    }
  }

  await telegramApi("answerPreCheckoutQuery", {
    pre_checkout_query_id: query.id,
    ok: !error,
    ...(error ? { error_message: error.slice(0, 200) } : {})
  }, { deadlineAt });
}

async function handleSuccessfulStarPayment(message) {
  const payment = message?.successful_payment;
  const validation = validateStarPurchasePayload(payment?.invoice_payload, {
    userId: message?.from?.id,
    currency: payment?.currency,
    totalAmount: payment?.total_amount,
    // Telegram may redeliver a valid completed payment after the invoice TTL.
    // The signed identity, currency, amount, and charge ID remain enforced.
    allowExpired: true
  });
  if (!validation.valid) {
    throw new Error(`Rejected an invalid successful Telegram Stars payment: ${validation.error}`);
  }

  const { purchase } = validation;
  const result = await requireStarLedger().creditPayment({
    userId: purchase.userId,
    amount: purchase.amount,
    telegramPaymentChargeId: payment.telegram_payment_charge_id,
    providerPaymentChargeId: payment.provider_payment_charge_id,
    invoicePayload: payment.invoice_payload,
    currency: payment.currency
  });
  const changed = result?.credited ?? result?.changed ?? true;
  if (!changed) return;

  const currentBalance = balanceValue(result);
  await sendTelegramText(
    message,
    [
      `Payment received: ${purchase.amount} Star${purchase.amount === 1 ? "" : "s"}.`,
      `Credits added: ${purchase.amount}`,
      `Current balance: ${currentBalance}`,
      `Payment ID: ${payment.telegram_payment_charge_id}`,
      "",
      "Send any non-command message to use 1 credit."
    ].join("\n")
  ).catch((error) => console.error(`Telegram payment confirmation failed: ${error.message}`));

  const adminId = telegramAdminUserId();
  if (adminId) {
    telegramApi("sendMessage", {
      chat_id: adminId,
      text: [
        "NvidBot Stars purchase received",
        `Buyer ID: ${purchase.userId}`,
        `Amount: ${purchase.amount} Stars`,
        `Payment ID: ${payment.telegram_payment_charge_id}`
      ].join("\n")
    }).catch((error) => console.error(`Telegram admin payment notice failed: ${error.message}`));
  }
}

async function handleRefundedStarPayment(message) {
  const refund = message?.refunded_payment;
  const validation = validateStarPurchasePayload(refund?.invoice_payload, {
    currency: refund?.currency,
    totalAmount: refund?.total_amount,
    allowExpired: true
  });
  if (!validation.valid) {
    throw new Error(`Rejected an invalid Telegram Stars refund: ${validation.error}`);
  }

  const { purchase } = validation;
  const result = await requireStarLedger().recordRefund({
    telegramPaymentChargeId: refund.telegram_payment_charge_id,
    userId: purchase.userId,
    amount: purchase.amount
  });
  if (!result?.payment || !result.changed) return;

  await sendTelegramText(message, [
    `Telegram refunded payment ${refund.telegram_payment_charge_id}.`,
    `Credits removed: ${result.deductedAmount}`,
    `Current balance: ${result.balance}`
  ].join("\n")).catch((error) => console.error(`Telegram refund confirmation failed: ${error.message}`));

  const adminId = telegramAdminUserId();
  if (adminId) {
    telegramApi("sendMessage", {
      chat_id: adminId,
      text: [
        "NvidBot Stars refund recorded",
        `Buyer ID: ${purchase.userId}`,
        `Amount: ${purchase.amount} Stars`,
        `Credits removed: ${result.deductedAmount}`,
        `Payment ID: ${refund.telegram_payment_charge_id}`
      ].join("\n")
    }).catch((error) => console.error(`Telegram admin refund notice failed: ${error.message}`));
  }
}

export function telegramUpdateRequiresSynchronousAck(update) {
  return Boolean(
    update?.pre_checkout_query
    || update?.message?.successful_payment
    || update?.message?.refunded_payment
    || String(update?.callback_query?.data || "").startsWith("s1.")
  );
}

async function handleTelegramCommand(command, message) {
  const chatId = message.chat.id;
  switch (command.name) {
    case "start":
      await sendTelegramWelcome(message);
      return true;
    case "help":
      await sendTelegramText(message, helpText());
      return true;
    case "models":
      await sendTelegramText(message, modelListText(chatId));
      return true;
    case "model": {
      if (!command.argument) {
        const current = availableModels().find((model) => model.id === preferredTelegramModel(chatId));
        await sendTelegramText(
          message,
          `Active model: ${current?.label || preferredTelegramModel(chatId)}\n\nUse /model <number or model name>. See /models for choices.`
        );
        return true;
      }
      const { model, matches } = resolveTelegramModel(command.argument);
      if (!model) {
        const detail = matches.length > 1
          ? `That name matches multiple models: ${matches.map(({ label }) => label).join(", ")}.`
          : "I could not find that model.";
        await sendTelegramText(message, `${detail}\n\nUse /models to see the available choices.`);
        return true;
      }
      const selected = selectModel(model.id);
      telegramModelPreferences.set(String(chatId), selected);
      await sendTelegramText(message, `Model changed to ${model.label} [${model.tag}].\n${model.id}`);
      return true;
    }
    case "reset":
      await resetConversation(conversationId(chatId));
      await sendTelegramText(message, "Conversation memory cleared. Your selected model is unchanged.");
      return true;
    case "balance": {
      if (!telegramStarsRequired()) {
        await sendTelegramText(message, "Telegram Stars charging is not enabled for this bot.");
        return true;
      }
      const balance = await requireStarLedger().getBalance(String(message.from?.id));
      await sendTelegramText(
        message,
        `Your NvidBot balance is ${balanceValue(balance)} AI message credit${balanceValue(balance) === "1" ? "" : "s"}.\n\nEach non-command AI prompt costs 1 credit. Use /topup <amount> to buy more.`
      );
      return true;
    }
    case "topup": {
      const amount = parseStarTopupAmount(command.argument);
      if (!amount) {
        await sendTelegramText(
          message,
          `Usage: /topup <amount>\nChoose any whole amount from ${MIN_STAR_TOPUP} to ${MAX_STAR_TOPUP}. Example: /topup 25`
        );
        return true;
      }
      await sendTopupOffer(message, amount);
      return true;
    }
    case "terms":
      await sendTelegramText(message, telegramStarTerms());
      return true;
    case "paysupport":
    case "support":
      await sendPaymentSupport(message, command.argument);
      return true;
    case "starbalance":
      await sendAdminStarBalance(message);
      return true;
    case "whoami":
      await sendTelegramText(message, whoAmIText(message));
      return true;
    default:
      await sendTelegramText(message, `Unknown command /${command.name}.\n\n${helpText()}`);
      return true;
  }
}

export async function handleTelegram(update) {
  if (update?.pre_checkout_query) {
    await handleTelegramPreCheckout(update.pre_checkout_query);
    return;
  }
  if (await handleStarPurchaseCallback(update?.callback_query)) return;

  const message = update?.message;
  if (message?.successful_payment) {
    await handleSuccessfulStarPayment(message);
    return;
  }
  if (message?.refunded_payment) {
    await handleRefundedStarPayment(message);
    return;
  }
  const text = message?.text?.trim();
  if (!text || message?.chat?.id === undefined || message?.chat?.id === null) return;

  const command = parseTelegramCommand(text);
  const configuredUsername = telegramStatus.username?.toLocaleLowerCase();
  if (command?.botUsername && configuredUsername && command.botUsername !== configuredUsername) return;

  // /whoami deliberately remains available so an owner can discover the ID to
  // place in TELEGRAM_ALLOWED_USER_IDS without first opening access to the bot.
  if (!telegramUserIsAllowed(message) && command?.name !== "whoami") {
    await sendTelegramText(
      message,
      `Access denied. Your Telegram user ID is ${message.from?.id ?? "unavailable"}. Send /whoami for full ID details.`
    );
    return;
  }

  if (command) {
    await handleTelegramCommand(command, message);
    return;
  }

  const chatKey = String(message.chat.id);
  if (telegramChatsInFlight.has(chatKey)) {
    await sendTelegramText(message, "I am still generating the previous answer. Please wait for it to finish.");
    return;
  }

  telegramChatsInFlight.add(chatKey);
  const reservationId = `telegram:${message.chat.id}:${message.message_id ?? update.update_id ?? "unknown"}`;
  let creditReserved = false;
  if (telegramStarsRequired()) {
    try {
      const ledger = requireStarLedger();
      const reservation = await ledger.reservePrompt(String(message.from?.id), { reservationId, cost: 1 });
      if (!reservation?.reserved) {
        telegramChatsInFlight.delete(chatKey);
        if (["reserved", "completed", "restored"].includes(reservation?.state)) return;
        await sendTelegramText(
          message,
          `You need 1 AI message credit for this prompt. Your balance is ${balanceValue(reservation)}.\n\nUse /topup <amount> to buy credits with Telegram Stars. Example: /topup 10`
        );
        return;
      }
      creditReserved = true;
    } catch (error) {
      telegramChatsInFlight.delete(chatKey);
      console.error(`Telegram credit reservation failed: ${error.message}`);
      await sendTelegramText(message, "The credit ledger is temporarily unavailable, so you were not charged. Please try again later.");
      return;
    }
  }

  const isPrivateChat = message.chat.type === "private";
  const model = preferredTelegramModel(message.chat.id);
  const draftId = telegramDraftId(update, message);
  let streamedText = "";
  let lastDraftAt = 0;
  let lastDraftText = "";
  let draftAvailable = isPrivateChat;
  let draftQueue = Promise.resolve();

  const sendTyping = () => telegramApi("sendChatAction", {
    chat_id: message.chat.id,
    action: "typing",
    ...messageThreadPayload(message)
  }).catch(() => undefined);

  await sendTyping();
  const typingTimer = setInterval(() => void sendTyping(), 4000);
  typingTimer.unref?.();

  const queueDraft = (force = false) => {
    if (!draftAvailable || !streamedText) return draftQueue;
    const now = Date.now();
    if (!force && now - lastDraftAt < DRAFT_INTERVAL_MS) return draftQueue;
    const draftText = Array.from(streamedText).slice(0, 4096).join("");
    if (!draftText || draftText === lastDraftText) return draftQueue;
    lastDraftAt = now;
    lastDraftText = draftText;
    draftQueue = draftQueue.then(async () => {
      try {
        await telegramApi("sendMessageDraft", {
          chat_id: message.chat.id,
          draft_id: draftId,
          text: draftText,
          ...messageThreadPayload(message)
        });
      } catch {
        // Older clients, bots without private topic mode, or transient Telegram
        // errors must not prevent delivery of the completed normal message.
        draftAvailable = false;
      }
    });
    return draftQueue;
  };

  try {
    const answer = await streamReply({
      conversationId: conversationId(message.chat.id),
      text,
      model,
      onDelta(delta) {
        streamedText += String(delta || "");
        void queueDraft(false);
      }
    });
    await queueDraft(true);
    await draftQueue;
    await sendTelegramText(message, answer || streamedText || "I could not generate a response.");
    if (creditReserved) {
      try {
        await requireStarLedger().completePrompt(reservationId);
      } catch (error) {
        // A stale reservation is restored during startup reconciliation. The
        // user has already received the answer, so do not send a false failure.
        console.error(`Telegram credit completion failed: ${error.message}`);
      }
    }
  } catch {
    if (creditReserved) {
      try {
        await requireStarLedger().restorePrompt(reservationId);
      } catch (error) {
        console.error(`Telegram credit restoration failed: ${error.message}`);
      }
    }
    await sendTelegramText(message, "I could not complete that response. Please try again in a moment.");
  } finally {
    clearInterval(typingTimer);
    telegramChatsInFlight.delete(chatKey);
  }
}

function validateTelegramWebhookSecret(secret) {
  if (!secret) throw new Error("TELEGRAM_WEBHOOK_SECRET is not configured");
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(secret)) {
    throw new Error("TELEGRAM_WEBHOOK_SECRET must be 1-256 letters, numbers, underscores, or hyphens");
  }
  return secret;
}

function telegramPublicBaseUrl() {
  const raw = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || "").trim();
  if (!raw) throw new Error("PUBLIC_URL or RENDER_EXTERNAL_URL is required for the Telegram webhook");
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("The Telegram public URL is invalid");
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("The Telegram public URL must be a public HTTPS URL without credentials");
  }
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export function telegramPublicStatus() {
  return {
    enabled: telegramStatus.enabled === true,
    configured: telegramStatus.configured === true,
    username: telegramStatus.username || null,
    displayName: telegramStatus.displayName || null,
    link: telegramStatus.link || null,
    webhookReady: telegramStatus.webhookReady === true,
    starsRequired: telegramStatus.starsRequired === true,
    starLedgerReady: telegramStatus.starLedgerReady === true
  };
}

export function telegramServiceReady() {
  if (!telegramStarsRequired()) return true;
  const status = telegramPublicStatus();
  return status.configured && status.starLedgerReady;
}

export async function configureTelegramBot() {
  const starsRequired = telegramStarsRequired();
  if (!process.env.TELEGRAM_BOT_TOKEN?.trim()) {
    telegramStatus = Object.freeze({
      enabled: false,
      configured: false,
      starsRequired,
      starLedgerReady: false
    });
    return telegramPublicStatus();
  }

  let starLedgerReady = false;
  telegramStatus = Object.freeze({
    enabled: true,
    configured: false,
    state: "configuring",
    starsRequired,
    starLedgerReady
  });
  try {
    telegramToken();
    const secret = validateTelegramWebhookSecret(process.env.TELEGRAM_WEBHOOK_SECRET?.trim());
    starLedgerReady = await initializeTelegramStars();
    const webhookUrl = `${telegramPublicBaseUrl()}/webhooks/telegram`;
    const me = await telegramApi("getMe");
    await telegramApi("setMyShortDescription", {
      short_description: TELEGRAM_BOT_SHORT_DESCRIPTION
    });
    await telegramApi("setMyDescription", {
      description: TELEGRAM_BOT_DESCRIPTION
    });
    await telegramApi("setMyCommands", { commands: TELEGRAM_COMMANDS });
    await telegramApi("setWebhook", {
      url: webhookUrl,
      secret_token: secret,
      allowed_updates: ["message", "pre_checkout_query", "callback_query"],
      max_connections: 10
    });
    const webhook = await telegramApi("getWebhookInfo");
    const webhookMatches = webhook?.url === webhookUrl;

    telegramStatus = Object.freeze({
      enabled: true,
      configured: webhookMatches,
      username: me?.username || null,
      displayName: me?.first_name || null,
      link: me?.username ? `https://t.me/${me.username}` : null,
      webhookReady: webhookMatches,
      starsRequired,
      starLedgerReady,
      pendingUpdates: Number(webhook?.pending_update_count || 0),
      lastWebhookError: webhook?.last_error_message || null
    });
    return telegramPublicStatus();
  } catch (error) {
    telegramStatus = Object.freeze({
      enabled: true,
      configured: false,
      starsRequired,
      starLedgerReady,
      error: error instanceof Error ? error.message : "Telegram setup failed"
    });
    throw error;
  }
}

export function validMetaSignature(rawBody, signature) {
  if (!process.env.META_APP_SECRET || !signature?.startsWith("sha256=")) return false;
  const expected = `sha256=${crypto.createHmac("sha256", process.env.META_APP_SECRET).update(rawBody).digest("hex")}`;
  const left = Buffer.from(expected);
  const right = Buffer.from(signature);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export async function handleWhatsApp(payload) {
  const message = payload.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  const text = message?.text?.body?.trim();
  if (!text || !message?.from) return;

  const answer = await reply({ conversationId: `whatsapp:${message.from}`, text });
  const version = process.env.WHATSAPP_GRAPH_VERSION || "v23.0";
  const response = await fetch(`https://graph.facebook.com/${version}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: message.from,
      type: "text",
      text: { body: answer.slice(0, 4096) }
    })
  });
  if (!response.ok) throw new Error(`WhatsApp returned ${response.status}: ${(await response.text()).slice(0, 200)}`);
}
