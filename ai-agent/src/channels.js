import crypto from "node:crypto";
import {
  availableModels,
  defaultModel,
  reply,
  resetConversation,
  selectModel,
  streamReply
} from "./agent.js";

const TELEGRAM_API_ROOT = "https://api.telegram.org";
const TELEGRAM_TEXT_LIMIT = 4000;
const DRAFT_INTERVAL_MS = 900;
const telegramModelPreferences = new Map();
const telegramChatsInFlight = new Set();
let telegramStatus = Object.freeze({ enabled: false, configured: false });

const TELEGRAM_COMMANDS = [
  { command: "start", description: "Start NvidBot" },
  { command: "help", description: "Show available commands" },
  { command: "models", description: "List available NVIDIA models" },
  { command: "model", description: "View or change the active model" },
  { command: "reset", description: "Clear this chat's AI memory" },
  { command: "whoami", description: "Show your Telegram IDs" }
];

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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
export async function telegramApi(method, payload = {}) {
  const token = telegramToken();

  for (let attempt = 0; attempt < 2; attempt += 1) {
    let response;
    try {
      response = await fetch(`${TELEGRAM_API_ROOT}/bot${token}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15_000)
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
      await wait(Number.isFinite(retryAfter) && retryAfter >= 0 ? retryAfter * 1000 : 1000);
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
  return [
    "NvidBot commands:",
    "",
    "/models - list available NVIDIA models",
    "/model <number or name> - change the model for this chat",
    "/reset - clear this chat's AI memory",
    "/whoami - show your Telegram user and chat IDs",
    "/help - show this guide",
    "",
    "Or send a message to chat with the active NVIDIA model."
  ].join("\n");
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

function telegramDraftId(update, message) {
  const seed = `${update.update_id ?? "update"}:${message.chat.id}:${message.message_id ?? "message"}`;
  return (crypto.createHash("sha256").update(seed).digest().readUInt32BE(0) & 0x7fffffff) || 1;
}

async function handleTelegramCommand(command, message) {
  const chatId = message.chat.id;
  switch (command.name) {
    case "start":
      await sendTelegramText(message, `Welcome to NvidBot.\n\n${helpText()}`);
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
    case "whoami":
      await sendTelegramText(message, whoAmIText(message));
      return true;
    default:
      await sendTelegramText(message, `Unknown command /${command.name}.\n\n${helpText()}`);
      return true;
  }
}

export async function handleTelegram(update) {
  const message = update?.message;
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
  } catch {
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
    webhookReady: telegramStatus.webhookReady === true
  };
}

export async function configureTelegramBot() {
  if (!process.env.TELEGRAM_BOT_TOKEN?.trim()) {
    telegramStatus = Object.freeze({ enabled: false, configured: false });
    return telegramPublicStatus();
  }

  telegramStatus = Object.freeze({ enabled: true, configured: false, state: "configuring" });
  try {
    telegramToken();
    const secret = validateTelegramWebhookSecret(process.env.TELEGRAM_WEBHOOK_SECRET?.trim());
    const webhookUrl = `${telegramPublicBaseUrl()}/webhooks/telegram`;
    const me = await telegramApi("getMe");
    await telegramApi("setMyCommands", { commands: TELEGRAM_COMMANDS });
    await telegramApi("setWebhook", {
      url: webhookUrl,
      secret_token: secret,
      allowed_updates: ["message"],
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
      pendingUpdates: Number(webhook?.pending_update_count || 0),
      lastWebhookError: webhook?.last_error_message || null
    });
    return telegramPublicStatus();
  } catch (error) {
    telegramStatus = Object.freeze({
      enabled: true,
      configured: false,
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
