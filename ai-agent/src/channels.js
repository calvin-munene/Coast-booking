import crypto from "node:crypto";
import { reply } from "./agent.js";

export async function handleTelegram(update) {
  const message = update.message;
  const text = message?.text?.trim();
  if (!text || !message?.chat?.id) return;

  const answer = await reply({ conversationId: `telegram:${message.chat.id}`, text });
  const response = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: message.chat.id, text: answer.slice(0, 4096) })
  });
  if (!response.ok) throw new Error(`Telegram returned ${response.status}`);
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
