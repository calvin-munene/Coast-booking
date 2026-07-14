# NVIDIA multichannel AI agent

One Node.js service powers a browser chat, Telegram bot, and WhatsApp Cloud API bot. Conversation history is kept in memory for this MVP and resets when the server restarts.

## Run locally

1. Install Node.js 20 or newer.
2. Copy `.env.example` to `.env` and add your NVIDIA API key.
3. Run `npm start`.
4. Open `http://localhost:3000`.

Never put API keys in browser code or commit `.env`.

## Browser model selector

The browser can switch between the server-approved NVIDIA models returned by `/api/models`. Set `NVIDIA_MODEL` for the preferred default and optionally set `NVIDIA_MODELS` to an authoritative comma-separated allowlist. If the preferred default is not in that allowlist, the first allowed model becomes the default. The NVIDIA API key remains server-side, and model IDs submitted by the browser are rejected unless they are allowed.

Browser answers stream token-by-token over a protected server-sent event connection. The **STOP** control cancels the active NVIDIA request; partial cancelled answers are shown but are not added to conversation memory.

## Deploy on Render

The repository includes a root-level `render.yaml` Blueprint. In Render, create a new Blueprint from the GitHub repository, then provide the secret values requested during setup. Render supplies `PORT` automatically.

## Telegram

1. Create a bot using `@BotFather`, then place its token in the Render `TELEGRAM_BOT_TOKEN` secret.
2. Set `PUBLIC_URL` to the deployed HTTPS origin and provide a random `TELEGRAM_WEBHOOK_SECRET`.
3. Optionally set `TELEGRAM_ALLOWED_USER_IDS` to a comma-separated list of Telegram user IDs so only those people can spend the NVIDIA quota. Send `/whoami` to the bot to discover your numeric ID.

At startup the service validates the token, publishes the bot command menu, registers the protected webhook, and verifies it with Telegram. Private chats receive animated native message drafts while NVIDIA generates the answer; the completed answer is then persisted as a normal reply. Group chats receive typing status followed by the final answer.

Bot commands:

- `/start` and `/help` show usage.
- `/models` lists server-approved NVIDIA models.
- `/model 2` or `/model <model-id>` changes the model for that Telegram chat.
- `/reset` clears that chat's in-memory AI context.
- `/whoami` shows the user and chat IDs used by the optional allowlist.

## WhatsApp Cloud API

1. Create a Meta developer app, add WhatsApp, and obtain a permanent access token and phone-number ID.
2. Set the callback URL to `https://YOUR_DOMAIN/webhooks/whatsapp` and use the same value as `WHATSAPP_VERIFY_TOKEN`.
3. Subscribe the webhook to the `messages` field.
4. Set `META_APP_SECRET` to the app secret; incoming POST requests are verified with `X-Hub-Signature-256`.

During Meta's test phase, add recipient numbers in the developer dashboard. Production use requires the appropriate business setup, permissions, and message-template rules.

## Production checklist

- Replace in-memory history with Redis or a database.
- Add user authentication and per-user rate limits to `/api/chat`.
- Add durable webhook jobs and centralized monitoring for higher traffic.
- Deploy behind HTTPS and rotate any key that has ever been exposed.
