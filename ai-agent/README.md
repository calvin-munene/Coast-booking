# NVIDIA multichannel AI agent

One Node.js service powers a browser chat, Telegram bot, and WhatsApp Cloud API bot. Conversation history is kept in memory for this MVP and resets when the server restarts.

## Run locally

1. Install Node.js 20 or newer.
2. Copy `.env.example` to `.env` and add your NVIDIA API key.
3. Run `npm start`.
4. Open `http://localhost:3000`.

Never put API keys in browser code or commit `.env`.

## Deploy on Render

The repository includes a root-level `render.yaml` Blueprint. In Render, create a new Blueprint from the GitHub repository, then provide the secret values requested during setup. Render supplies `PORT` automatically.

## Telegram

1. Create a bot using `@BotFather`, then place its token in `TELEGRAM_BOT_TOKEN`.
2. Deploy this service at a public HTTPS URL.
3. Register the webhook (replace the placeholders):

```bash
curl -X POST "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://YOUR_DOMAIN/webhooks/telegram","secret_token":"YOUR_WEBHOOK_SECRET","allowed_updates":["message"]}'
```

## WhatsApp Cloud API

1. Create a Meta developer app, add WhatsApp, and obtain a permanent access token and phone-number ID.
2. Set the callback URL to `https://YOUR_DOMAIN/webhooks/whatsapp` and use the same value as `WHATSAPP_VERIFY_TOKEN`.
3. Subscribe the webhook to the `messages` field.
4. Set `META_APP_SECRET` to the app secret; incoming POST requests are verified with `X-Hub-Signature-256`.

During Meta's test phase, add recipient numbers in the developer dashboard. Production use requires the appropriate business setup, permissions, and message-template rules.

## Production checklist

- Replace in-memory history with Redis or a database.
- Add user authentication and per-user rate limits to `/api/chat`.
- Add logging, monitoring, retries, and a job queue for webhooks.
- Deploy behind HTTPS and rotate any key that has ever been exposed.
