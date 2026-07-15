import crypto from "node:crypto";
import {
  availableModels,
  defaultModel,
  reply,
  resetConversation,
  selectModel,
  streamReply
} from "./agent.js";
import { logger } from "./logger.js";
import { aiChatStarCost } from "./pricing.js";
import { createStarLedger } from "./starLedger.js";
import {
  ASSISTANT_MODE_DEFINITIONS,
  assistantModeList,
  assistantSystemPrompt,
  normalizeAssistantMode
} from "./assistantModes.js";
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
function telegramBotDescription() {
  const cost = aiChatStarCost();
  return [
    "NvidBot is a hacker-style AI assistant powered by NVIDIA models.",
    "Use it for coding help, debugging, research, planning, content, and technical answers.",
    `On Telegram, each accepted non-command AI prompt costs ${cost} prepaid credit${cost === 1 ? "" : "s"}.`,
    "Use /topup to buy credits with Telegram Stars, /models to switch models, and /help for the full command list."
  ].join(" ");
}
const TELEGRAM_WELCOME_IMAGE_PATH = "/telegram/welcome-banner.png";
const MODE_DEFINITIONS = Object.freeze({
  chat: {
    label: "AI Chat Mode",
    defaultEnabled: true,
    billable: true,
    selectable: true,
    description: "Normal AI conversations. This is the only mode that consumes credits."
  },
  inline: {
    label: "Inline Mode",
    defaultEnabled: false,
    billable: false,
    description: "Allows users to invoke bot utilities from Telegram inline queries when enabled in BotFather."
  },
  bot_management: {
    label: "Bot Management Mode",
    defaultEnabled: true,
    billable: false,
    description: "Admin-only commands for modes, bans, balances, and user management."
  },
  guest_chat: {
    label: "Guest Chat Mode",
    defaultEnabled: true,
    billable: false,
    description: "Lets non-admin users access free setup, help, top-up, model, and persona commands."
  },
  guard: {
    label: "Guard Mode",
    defaultEnabled: false,
    billable: false,
    description: "Handles group join requests and rejects banned users when the bot is a group admin."
  },
  secretary: {
    label: "Secretary Mode",
    defaultEnabled: true,
    billable: false,
    selectable: true,
    description: "Adapts AI Chat into an executive assistant for permitted messages, tasks, notes, and drafts."
  },
  bot_to_bot: {
    label: "Bot to Bot Communication Mode",
    defaultEnabled: false,
    billable: false,
    description: "Reserved for bot-to-bot or business integrations. It is disabled by default to avoid loops."
  },
  threaded: {
    label: "Threaded Mode",
    defaultEnabled: true,
    billable: false,
    description: "Keeps replies in Telegram forum topics and message threads."
  },
  coding: {
    label: "Coding Mode",
    defaultEnabled: true,
    billable: false,
    selectable: true,
    description: "Tunes AI Chat for implementation, debugging, review, and architecture."
  },
  research: {
    label: "Research Mode",
    defaultEnabled: true,
    billable: false,
    selectable: true,
    description: "Tunes AI Chat for structured analysis, comparisons, and uncertainty checks."
  },
  translation: {
    label: "Translation Mode",
    defaultEnabled: true,
    billable: false,
    selectable: true,
    description: "Tunes AI Chat for faithful translation and localization."
  },
  documents: {
    label: "Documents Mode",
    defaultEnabled: true,
    billable: false,
    selectable: true,
    description: "Tunes AI Chat to analyze, summarize, and draft text supplied in the chat."
  }
});
const DEFAULT_MODE_SETTINGS = Object.freeze(Object.fromEntries(
  Object.entries(MODE_DEFINITIONS).map(([mode, definition]) => [mode, definition.defaultEnabled])
));

const TELEGRAM_COMMANDS = [
  { command: "start", description: "Start NvidBot" },
  { command: "help", description: "Show available commands" },
  { command: "dashboard", description: "Open the NvidBot mini app" },
  { command: "modes", description: "Show enabled bot modes" },
  { command: "mode", description: "Admin: turn a bot mode on or off" },
  { command: "use", description: "Select your active AI assistant mode" },
  { command: "persona", description: "Customize how the AI answers you" },
  { command: "models", description: "List available NVIDIA models" },
  { command: "model", description: "View or change the active model" },
  { command: "reset", description: "Clear this chat's AI memory" },
  { command: "balance", description: "Show AI message credits" },
  { command: "topup", description: "Buy credits with Telegram Stars" },
  { command: "terms", description: "Read the Stars purchase terms" },
  { command: "paysupport", description: "Get help with a Stars payment" },
  { command: "ban", description: "Admin: block a user from the bot" },
  { command: "unban", description: "Admin: restore a blocked user" },
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

function defaultModeSettings() {
  return { ...DEFAULT_MODE_SETTINGS };
}

function modeExists(mode) {
  return Object.hasOwn(MODE_DEFINITIONS, mode);
}

function selectedAssistantMode(userControl, settings) {
  const requested = normalizeAssistantMode(userControl?.selectedMode || "chat", { fallback: "chat" });
  return settings[requested] === false ? "chat" : requested;
}

async function currentModeSettings() {
  if (!telegramStarLedger || typeof telegramStarLedger.getModeSettings !== "function") return defaultModeSettings();
  return telegramStarLedger.getModeSettings(defaultModeSettings());
}

async function modeEnabled(mode) {
  return (await currentModeSettings())[mode] !== false;
}

function assertTelegramAdmin(message) {
  if (!telegramUserIsAdmin(message.from?.id)) {
    return "This command is available only to the configured bot administrator.";
  }
  return null;
}

function parseModeToggle(argument) {
  const [rawMode, rawState] = String(argument || "").trim().split(/\s+/, 2);
  const mode = rawMode?.toLowerCase();
  const state = rawState?.toLowerCase();
  if (!mode || !modeExists(mode)) return null;
  if (!["on", "off", "enable", "disable", "enabled", "disabled"].includes(state)) return null;
  return { mode, enabled: ["on", "enable", "enabled"].includes(state) };
}

function modeListText(settings = defaultModeSettings(), { admin = false } = {}) {
  const lines = ["NvidBot modes:"];
  for (const [mode, definition] of Object.entries(MODE_DEFINITIONS)) {
    const enabled = settings[mode] !== false;
    lines.push(
      "",
      `${enabled ? "ON" : "OFF"} ${mode} - ${definition.label}`,
      `${definition.description}${definition.billable ? ` Credit cost: ${aiChatStarCost()} per accepted prompt.` : " Credit cost: free."}`
    );
  }
  if (admin) lines.push("", "Admin usage: /mode <mode> on|off");
  lines.push("", `Choose your assistant behavior with /use <${Object.keys(ASSISTANT_MODE_DEFINITIONS).join("|")}>.`);
  return lines.join("\n");
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
      logger.info("telegram.credit_reservations_restored", { restoredCount: restored.restoredCount });
    }
  } finally {
    telegramStarSweepInFlight = false;
  }
}

function startTelegramStarReconciliation() {
  if (telegramStarSweepTimer) return;
  telegramStarSweepTimer = setInterval(() => {
    reconcileStaleTelegramCredits().catch((error) => {
      logger.error("telegram.credit_reconciliation_failed", { error });
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

function telegramConversationScope(message) {
  const chatId = String(message?.chat?.id ?? "unknown");
  const userId = String(message?.from?.id ?? "unknown");
  const threadId = String(message?.message_thread_id ?? "main");
  if (message?.chat?.type === "private") return `chat:${chatId}:user:${userId}`;
  return `chat:${chatId}:thread:${threadId}:user:${userId}`;
}

function conversationId(message) {
  return `telegram:${telegramConversationScope(message)}`;
}

function preferredTelegramModel(message) {
  const preferenceKey = telegramConversationScope(message);
  const stored = telegramModelPreferences.get(preferenceKey);
  try {
    return selectModel(stored || defaultModel());
  } catch {
    telegramModelPreferences.delete(preferenceKey);
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

function modelListText(message) {
  const current = preferredTelegramModel(message);
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
    "/dashboard - open the Telegram mini app",
    "/modes - show active bot modes",
    "/use <mode> - tune the assistant for chat, coding, research, translation, documents, or secretary work",
    "/persona <instructions> - customize how the AI answers you",
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
      ? `Each non-command AI prompt costs ${aiChatStarCost()} message credit${aiChatStarCost() === 1 ? "" : "s"}. One Telegram Star buys one credit.`
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
    "/dashboard - open your NvidBot control panel",
    "/use <mode> - choose how Nvid AI should work for you",
    "/persona <instructions> - customize the bot's style for you",
    "/models - browse available NVIDIA models",
    "/model <number or name> - switch the active model",
    "/reset - clear this chat's memory",
    "/help - show all commands"
  ];
  lines.push(
    "",
    telegramStarsRequired()
      ? `Telegram pricing: each accepted non-command AI prompt costs ${aiChatStarCost()} credit${aiChatStarCost() === 1 ? "" : "s"}. Use /topup <amount> to buy credits with Telegram Stars.`
      : "Send any message to start chatting with the active NVIDIA model."
  );
  return lines.join("\n");
}

function miniAppUrl() {
  return `${telegramPublicBaseUrl()}/miniapp.html`;
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
    logger.error("telegram.welcome_image_failed", { error });
    await sendTelegramText(message, caption);
  }
}

async function sendTelegramDashboard(message) {
  await telegramApi("sendMessage", {
    chat_id: message.chat.id,
    text: "Open the NvidBot control panel.",
    reply_markup: {
      inline_keyboard: [[{
        text: "Open NvidBot Dashboard",
        web_app: { url: miniAppUrl() }
      }]]
    },
    ...messageThreadPayload(message),
    ...(message.message_id
      ? { reply_parameters: { message_id: message.message_id, allow_sending_without_reply: true } }
      : {})
  });
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
      `One accepted AI prompt costs ${aiChatStarCost()} credit${aiChatStarCost() === 1 ? "" : "s"}. Commands are free. Read /terms for the full terms.`,
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
    description: `${purchase.amount} prepaid AI message credit${purchase.amount === 1 ? "" : "s"}. ${aiChatStarCost()} credit${aiChatStarCost() === 1 ? " is" : "s are"} used per accepted prompt.`,
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

function memberCanManageJoinRequests(member) {
  if (member?.status === "creator") return true;
  return member?.status === "administrator" && member?.can_invite_users === true;
}

async function guardPermissionState(chatId, requesterId) {
  const bot = await telegramApi("getMe");
  const [requester, botMember] = await Promise.all([
    requesterId ? telegramApi("getChatMember", { chat_id: chatId, user_id: requesterId }) : null,
    telegramApi("getChatMember", { chat_id: chatId, user_id: bot.id })
  ]);
  return {
    requesterAllowed: requesterId ? memberCanManageJoinRequests(requester) : true,
    botAllowed: memberCanManageJoinRequests(botMember)
  };
}

async function answerGuardCallback(callback, text, showAlert = true) {
  await telegramApi("answerCallbackQuery", {
    callback_query_id: callback.id,
    text,
    show_alert: showAlert
  });
}

async function handleGuardCallback(callback) {
  const match = String(callback?.data || "").match(/^g1\.(approve|deny)\.(-?\d+)\.(\d+)$/);
  if (!match) return false;
  if (!(await modeEnabled("guard"))) {
    await answerGuardCallback(callback, "Guard Mode is disabled. No join-request action was taken.");
    return true;
  }
  if (!telegramUserIsAdmin(callback.from?.id)) {
    await answerGuardCallback(callback, "Only the bot administrator can manage join requests.");
    return true;
  }
  const [, action, chatId, userId] = match;
  let permissions;
  try {
    permissions = await guardPermissionState(chatId, callback.from.id);
  } catch {
    await answerGuardCallback(callback, "Telegram permissions could not be verified. No action was taken.");
    return true;
  }
  if (!permissions.requesterAllowed) {
    await answerGuardCallback(callback, "You must currently be a group administrator with invite-user permission.");
    return true;
  }
  if (!permissions.botAllowed) {
    await answerGuardCallback(callback, "Promote NvidBot and grant invite-user permission before managing join requests.");
    return true;
  }
  const method = action === "approve" ? "approveChatJoinRequest" : "declineChatJoinRequest";
  try {
    await telegramApi(method, { chat_id: chatId, user_id: userId });
  } catch {
    await answerGuardCallback(callback, "Telegram rejected the join-request action. Check current group permissions.");
    return true;
  }
  await answerGuardCallback(callback, action === "approve" ? "Join request approved." : "Join request denied.", false);
  return true;
}

async function handleTelegramInlineQuery(inlineQuery) {
  if (!inlineQuery?.id) return false;
  if (!(await modeEnabled("inline"))) {
    await telegramApi("answerInlineQuery", {
      inline_query_id: inlineQuery.id,
      results: [],
      cache_time: 1,
      is_personal: true,
      button: { text: "Inline Mode is disabled", start_parameter: "inline_disabled" }
    });
    return true;
  }
  const query = String(inlineQuery.query || "").trim();
  const title = query ? `Open NvidBot for: ${query.slice(0, 48)}` : "Open NvidBot";
  await telegramApi("answerInlineQuery", {
    inline_query_id: inlineQuery.id,
    cache_time: 1,
    is_personal: true,
    results: [{
      type: "article",
      id: crypto.createHash("sha256").update(`${inlineQuery.id}:${query}`).digest("hex").slice(0, 32),
      title,
      description: "Launch the NVIDIA AI assistant. Inline utility is free; full AI chat runs inside the bot.",
      input_message_content: {
        message_text: query
          ? `NvidBot request: ${query}\n\nOpen the bot to run this through AI chat.`
          : "Open NvidBot to use NVIDIA AI chat, modes, and the dashboard."
      },
      reply_markup: {
        inline_keyboard: [[{
          text: "Open NvidBot",
          url: telegramStatus.link || miniAppUrl()
        }]]
      }
    }]
  });
  return true;
}

async function handleTelegramJoinRequest(joinRequest) {
  if (!joinRequest?.chat?.id || !joinRequest?.from?.id) return false;
  if (!(await modeEnabled("guard"))) return true;
  const userControl = telegramStarLedger
    ? await telegramStarLedger.getUserControl(String(joinRequest.from.id)).catch(() => null)
    : null;
  if (userControl?.banned) {
    let botAllowed = false;
    try {
      botAllowed = (await guardPermissionState(joinRequest.chat.id, null)).botAllowed;
    } catch {
      // Permission verification must fail closed for an automatic moderation action.
    }
    if (botAllowed) {
      await telegramApi("declineChatJoinRequest", {
        chat_id: joinRequest.chat.id,
        user_id: joinRequest.from.id
      });
    } else if (telegramAdminUserId()) {
      await telegramApi("sendMessage", {
        chat_id: telegramAdminUserId(),
        text: `Guard Mode did not decline banned user ${joinRequest.from.id} in ${joinRequest.chat.title || joinRequest.chat.id} because NvidBot's invite-user permission could not be verified.`
      }).catch(() => undefined);
    }
    return true;
  }
  const adminId = telegramAdminUserId();
  if (adminId) {
    await telegramApi("sendMessage", {
      chat_id: adminId,
      text: [
        "NvidBot Guard Mode join request",
        `Group: ${joinRequest.chat.title || joinRequest.chat.id}`,
        `User ID: ${joinRequest.from.id}`,
        `Name: ${[joinRequest.from.first_name, joinRequest.from.last_name].filter(Boolean).join(" ") || "unknown"}`,
        joinRequest.from.username ? `Username: @${joinRequest.from.username}` : "Username: not provided"
      ].join("\n"),
      reply_markup: {
        inline_keyboard: [[
          { text: "Approve", callback_data: `g1.approve.${joinRequest.chat.id}.${joinRequest.from.id}` },
          { text: "Deny", callback_data: `g1.deny.${joinRequest.chat.id}.${joinRequest.from.id}` }
        ]]
      }
    });
  }
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
  ).catch((error) => logger.error("telegram.payment_confirmation_failed", { error }));

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
    }).catch((error) => logger.error("telegram.admin_payment_notice_failed", { error }));
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
  ].join("\n")).catch((error) => logger.error("telegram.refund_confirmation_failed", { error }));

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
    }).catch((error) => logger.error("telegram.admin_refund_notice_failed", { error }));
  }
}

export function telegramUpdateRequiresSynchronousAck(update) {
  return Boolean(
    update?.pre_checkout_query
    || update?.message?.successful_payment
    || update?.message?.refunded_payment
    || String(update?.callback_query?.data || "").startsWith("s1.")
    || String(update?.callback_query?.data || "").startsWith("g1.")
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
    case "dashboard":
    case "app":
      await sendTelegramDashboard(message);
      return true;
    case "modes": {
      await sendTelegramText(message, modeListText(await currentModeSettings(), { admin: telegramUserIsAdmin(message.from?.id) }));
      return true;
    }
    case "mode": {
      const adminError = assertTelegramAdmin(message);
      if (adminError) {
        await sendTelegramText(message, adminError);
        return true;
      }
      const toggle = parseModeToggle(command.argument);
      if (!toggle) {
        await sendTelegramText(
          message,
          `Usage: /mode <mode> on|off\n\nAvailable modes: ${Object.keys(MODE_DEFINITIONS).join(", ")}`
        );
        return true;
      }
      const result = await requireStarLedger().setModeEnabled(toggle.mode, toggle.enabled);
      await sendTelegramText(
        message,
        `${MODE_DEFINITIONS[result.mode].label} is now ${result.enabled ? "ON" : "OFF"}.\n\n${modeListText(await currentModeSettings(), { admin: true })}`
      );
      return true;
    }
    case "use": {
      if (!telegramStarLedger || typeof telegramStarLedger.setUserMode !== "function") {
        await sendTelegramText(message, "Assistant mode selection is temporarily unavailable.");
        return true;
      }
      const settings = await currentModeSettings();
      if (!command.argument) {
        const control = await telegramStarLedger.getUserControl(String(message.from?.id));
        const active = selectedAssistantMode(control, settings);
        const choices = assistantModeList(settings)
          .map((mode) => `${mode.enabled ? "ON" : "OFF"} ${mode.id} - ${mode.label}${mode.id === active ? " <- active" : ""}`)
          .join("\n");
        await sendTelegramText(message, `Your active assistant mode is ${active}.\n\n${choices}\n\nUse /use <mode> to switch.`);
        return true;
      }
      let requested;
      try {
        requested = normalizeAssistantMode(command.argument);
      } catch {
        await sendTelegramText(message, `Unknown assistant mode. Choose: ${Object.keys(ASSISTANT_MODE_DEFINITIONS).join(", ")}.`);
        return true;
      }
      if (settings[requested] === false) {
        await sendTelegramText(message, `${ASSISTANT_MODE_DEFINITIONS[requested].label} is disabled by the administrator.`);
        return true;
      }
      await telegramStarLedger.setUserMode(String(message.from?.id), requested);
      await sendTelegramText(message, `${ASSISTANT_MODE_DEFINITIONS[requested].label} is now active. Future AI Chat answers will use this mode.`);
      return true;
    }
    case "persona": {
      if (!(await modeEnabled("secretary"))) {
        await sendTelegramText(message, "Secretary Mode is currently disabled.");
        return true;
      }
      if (!telegramStarLedger) {
        await sendTelegramText(message, "Persona customization is temporarily unavailable.");
        return true;
      }
      if (!command.argument) {
        const control = await telegramStarLedger.getUserControl(String(message.from?.id));
        await sendTelegramText(
          message,
          control.persona
            ? `Your current AI customization:\n${control.persona}\n\nUpdate it with /persona <instructions>, or clear it with /persona clear.`
            : "No AI customization is set. Use /persona <instructions> to choose the tone, role, or response style you want."
        );
        return true;
      }
      const nextPersona = /^clear$/i.test(command.argument) ? null : command.argument;
      await telegramStarLedger.setUserPersona(String(message.from?.id), nextPersona);
      await sendTelegramText(
        message,
        nextPersona
          ? "Your AI customization was saved. Future chat answers will follow it when possible."
          : "Your AI customization was cleared."
      );
      return true;
    }
    case "models":
      await sendTelegramText(message, modelListText(message));
      return true;
    case "model": {
      if (!command.argument) {
        const current = availableModels().find((model) => model.id === preferredTelegramModel(message));
        await sendTelegramText(
          message,
          `Active model: ${current?.label || preferredTelegramModel(message)}\n\nUse /model <number or model name>. See /models for choices.`
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
      telegramModelPreferences.set(telegramConversationScope(message), selected);
      await sendTelegramText(message, `Model changed to ${model.label} [${model.tag}].\n${model.id}`);
      return true;
    }
    case "reset":
      await resetConversation(conversationId(message));
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
        `Your NvidBot balance is ${balanceValue(balance)} AI message credit${balanceValue(balance) === "1" ? "" : "s"}.\n\nEach non-command AI prompt costs ${aiChatStarCost()} credit${aiChatStarCost() === 1 ? "" : "s"}. Use /topup <amount> to buy more.`
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
      await sendTelegramText(message, telegramStarTerms(undefined, aiChatStarCost()));
      return true;
    case "paysupport":
    case "support":
      await sendPaymentSupport(message, command.argument);
      return true;
    case "ban": {
      const adminError = assertTelegramAdmin(message);
      if (adminError) {
        await sendTelegramText(message, adminError);
        return true;
      }
      const [targetUserId, ...reasonParts] = command.argument.split(/\s+/).filter(Boolean);
      if (!targetUserId) {
        await sendTelegramText(message, "Usage: /ban <telegram-user-id> [reason]");
        return true;
      }
      const reason = reasonParts.join(" ") || "Banned by administrator";
      const result = await requireStarLedger().setUserBan(targetUserId, true, reason);
      await sendTelegramText(message, `User ${result.userId} is banned from NvidBot.\nReason: ${result.banReason}`);
      return true;
    }
    case "unban": {
      const adminError = assertTelegramAdmin(message);
      if (adminError) {
        await sendTelegramText(message, adminError);
        return true;
      }
      const targetUserId = command.argument.split(/\s+/).filter(Boolean)[0];
      if (!targetUserId) {
        await sendTelegramText(message, "Usage: /unban <telegram-user-id>");
        return true;
      }
      const result = await requireStarLedger().setUserBan(targetUserId, false, null);
      await sendTelegramText(message, `User ${result.userId} can use NvidBot again.`);
      return true;
    }
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
  if (await handleGuardCallback(update?.callback_query)) return;
  if (await handleTelegramInlineQuery(update?.inline_query)) return;
  if (await handleTelegramJoinRequest(update?.chat_join_request)) return;

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
  const isAdminUser = telegramUserIsAdmin(message.from?.id);
  const userControl = telegramStarLedger && typeof telegramStarLedger.getUserControl === "function" && message.from?.id
    ? await telegramStarLedger.getUserControl(String(message.from.id)).catch((error) => {
        logger.error("telegram.user_control_lookup_failed", { error, userId: message.from.id });
        return null;
      })
    : null;

  if (userControl?.banned && !isAdminUser) {
    await sendTelegramText(
      message,
      `Access denied. Your Telegram user ID ${message.from?.id ?? "unavailable"} is banned from NvidBot.${userControl.banReason ? `\nReason: ${userControl.banReason}` : ""}\n\nUse /paysupport if you believe this is a mistake.`
    );
    return;
  }

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
    if (!isAdminUser && !(await modeEnabled("guest_chat")) && !["start", "help", "dashboard", "app", "terms", "paysupport", "support", "whoami"].includes(command.name)) {
      await sendTelegramText(message, "Guest Chat Mode is currently disabled. Only basic help and payment support commands are available.");
      return;
    }
    await handleTelegramCommand(command, message);
    return;
  }

  if (!(await modeEnabled("chat"))) {
    await sendTelegramText(message, "AI Chat Mode is currently disabled by the bot administrator. Commands remain available.");
    return;
  }

  const chatKey = telegramConversationScope(message);
  if (telegramChatsInFlight.has(chatKey)) {
    await sendTelegramText(message, "I am still generating the previous answer. Please wait for it to finish.");
    return;
  }

  telegramChatsInFlight.add(chatKey);
  const reservationId = `telegram:${message.chat.id}:${message.message_id ?? update.update_id ?? "unknown"}`;
  let creditReserved = false;
  const unlimitedCredits = isAdminUser || userControl?.unlimitedCredits === true;
  if (telegramStarsRequired() && !unlimitedCredits) {
    try {
      const ledger = requireStarLedger();
      const promptCost = aiChatStarCost();
      const reservation = await ledger.reservePrompt(String(message.from?.id), { reservationId, cost: promptCost });
      if (!reservation?.reserved) {
        telegramChatsInFlight.delete(chatKey);
        if (["reserved", "completed", "restored"].includes(reservation?.state)) return;
        await sendTelegramText(
          message,
          `You need ${promptCost} AI message credit${promptCost === 1 ? "" : "s"} for this prompt. Your balance is ${balanceValue(reservation)}.\n\nUse /topup <amount> to buy credits with Telegram Stars. Example: /topup 10`
        );
        return;
      }
      creditReserved = true;
    } catch (error) {
      telegramChatsInFlight.delete(chatKey);
      logger.error("telegram.credit_reservation_failed", { error, reservationId });
      await sendTelegramText(message, "The credit ledger is temporarily unavailable, so you were not charged. Please try again later.");
      return;
    }
  }

  const isPrivateChat = message.chat.type === "private";
  const model = preferredTelegramModel(message);
  const settings = await currentModeSettings();
  const activeAssistantMode = selectedAssistantMode(userControl, settings);
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
      conversationId: conversationId(message),
      text,
      model,
      systemPrompt: assistantSystemPrompt({ mode: activeAssistantMode, persona: userControl?.persona }),
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
        logger.error("telegram.credit_completion_failed", { error, reservationId });
      }
    }
  } catch {
    if (creditReserved) {
      try {
        await requireStarLedger().restorePrompt(reservationId);
      } catch (error) {
        logger.error("telegram.credit_restoration_failed", { error, reservationId });
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

export async function telegramDashboardState({ userId } = {}) {
  const resolvedUserId = userId === undefined || userId === null || userId === "" ? null : String(userId);
  const isAdmin = telegramUserIsAdmin(resolvedUserId);
  const modes = await currentModeSettings();
  let balance = null;
  let userControl = null;
  let stats = null;

  if (telegramStarLedger && resolvedUserId) {
    userControl = await telegramStarLedger.getUserControl(resolvedUserId);
    balance = await telegramStarLedger.getBalance(resolvedUserId);
  }
  if (isAdmin && telegramStarLedger) {
    stats = await telegramStarLedger.getStats();
  }

  return {
    userId: resolvedUserId,
    isAdmin,
    unlimitedCredits: isAdmin || userControl?.unlimitedCredits === true,
    balance: balance?.balance ?? null,
    banned: userControl?.banned === true,
    banReason: userControl?.banReason ?? null,
    persona: userControl?.persona ?? null,
    selectedMode: selectedAssistantMode(userControl, modes),
    assistantModes: assistantModeList(modes),
    modes: Object.fromEntries(Object.entries(MODE_DEFINITIONS).map(([mode, definition]) => [
      mode,
      {
        label: definition.label,
        enabled: modes[mode] !== false,
        billable: definition.billable,
        description: definition.description
      }
    ])),
    stats,
    telegram: telegramPublicStatus()
  };
}

export async function telegramBillingHistory({ userId = null, limit = 50 } = {}) {
  if (!telegramStarLedger
      || typeof telegramStarLedger.listPayments !== "function"
      || typeof telegramStarLedger.listUsage !== "function") {
    const error = new Error("Telegram billing history is temporarily unavailable");
    error.statusCode = 503;
    throw error;
  }
  const options = { userId, limit };
  const [payments, usage] = await Promise.all([
    telegramStarLedger.listPayments(options),
    telegramStarLedger.listUsage(options)
  ]);
  return { payments, usage };
}

function nvidiaHourlyRequestLimit() {
  const parsed = Number(process.env.NVIDIA_GLOBAL_REQUESTS_PER_HOUR || 300);
  return Number.isSafeInteger(parsed) && parsed >= 10 && parsed <= 1_000_000 ? parsed : 300;
}

export async function reserveTelegramWebAiUsage({ userId, requestId, model } = {}) {
  const resolvedUserId = String(userId ?? "");
  if (!/^[1-9]\d*$/.test(resolvedUserId)
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(requestId || ""))) {
    return { allowed: false, status: 400, error: "A valid authenticated request ID is required" };
  }
  if (!(await modeEnabled("chat"))) {
    return { allowed: false, status: 403, error: "AI Chat Mode is currently disabled" };
  }
  if (!telegramStarLedger
      || typeof telegramStarLedger.getUserControl !== "function"
      || typeof telegramStarLedger.reserveProviderCapacity !== "function") {
    return { allowed: false, status: 503, error: "AI usage controls are temporarily unavailable" };
  }

  const userControl = await telegramStarLedger.getUserControl(resolvedUserId);
  const modeSettings = await currentModeSettings();
  const activeAssistantMode = selectedAssistantMode(userControl, modeSettings);
  const isAdmin = telegramUserIsAdmin(resolvedUserId);
  if (userControl?.banned && !isAdmin) {
    return { allowed: false, status: 403, error: "This account is not permitted to use NvidBot" };
  }

  const reservationId = `web:${resolvedUserId}:${requestId}`;
  const unlimitedCredits = isAdmin || userControl?.unlimitedCredits === true;
  let creditReserved = false;
  if (telegramStarsRequired() && !unlimitedCredits) {
    const promptCost = aiChatStarCost();
    const reservation = await telegramStarLedger.reservePrompt(resolvedUserId, { reservationId, cost: promptCost });
    if (!reservation?.reserved) {
      const duplicate = ["reserved", "completed", "restored"].includes(reservation?.state);
      return {
        allowed: false,
        status: duplicate ? 409 : 402,
        error: duplicate
          ? "This AI request has already been processed"
          : `You need ${promptCost} AI message credit${promptCost === 1 ? "" : "s"}. Current balance: ${balanceValue(reservation)}`
      };
    }
    creditReserved = true;
  }

  try {
    const providerBudget = await telegramStarLedger.reserveProviderCapacity({
      providerKey: "nvidia",
      limit: nvidiaHourlyRequestLimit(),
      cost: model === "nvidia/llama-3.3-nemotron-super-49b-v1.5" ? 2 : 1,
      windowSeconds: 3600
    });
    if (!providerBudget?.reserved) {
      if (creditReserved) await telegramStarLedger.restorePrompt(reservationId);
      return { allowed: false, status: 429, error: "The NVIDIA hourly safety limit has been reached. Try again later." };
    }
  } catch (error) {
    if (creditReserved) await telegramStarLedger.restorePrompt(reservationId).catch(() => undefined);
    throw error;
  }

  return {
    allowed: true,
    userId: resolvedUserId,
    reservationId,
    creditReserved,
    unlimitedCredits,
    persona: userControl?.persona ?? null,
    selectedMode: activeAssistantMode,
    systemPrompt: assistantSystemPrompt({ mode: activeAssistantMode, persona: userControl?.persona })
  };
}

export async function setTelegramAssistantMode({ userId, mode } = {}) {
  const resolvedUserId = String(userId ?? "");
  if (!/^[1-9]\d*$/.test(resolvedUserId)) throw new TypeError("userId must be a Telegram user ID");
  const selectedMode = normalizeAssistantMode(mode);
  const settings = await currentModeSettings();
  if (settings[selectedMode] === false) {
    const error = new Error("That assistant mode is disabled by the administrator");
    error.statusCode = 403;
    throw error;
  }
  if (!telegramStarLedger || typeof telegramStarLedger.setUserMode !== "function") {
    const error = new Error("Assistant mode selection is temporarily unavailable");
    error.statusCode = 503;
    throw error;
  }
  return telegramStarLedger.setUserMode(resolvedUserId, selectedMode);
}

export async function completeTelegramWebAiUsage(usage) {
  if (usage?.creditReserved) await requireStarLedger().completePrompt(usage.reservationId);
}

export async function restoreTelegramWebAiUsage(usage) {
  if (usage?.creditReserved) await requireStarLedger().restorePrompt(usage.reservationId);
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
      description: telegramBotDescription()
    });
    await telegramApi("setChatMenuButton", {
      menu_button: {
        type: "web_app",
        text: "NvidBot",
        web_app: { url: miniAppUrl() }
      }
    });
    await telegramApi("setMyCommands", { commands: TELEGRAM_COMMANDS });
    await telegramApi("setWebhook", {
      url: webhookUrl,
      secret_token: secret,
      allowed_updates: ["message", "pre_checkout_query", "callback_query", "inline_query", "chat_join_request"],
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
