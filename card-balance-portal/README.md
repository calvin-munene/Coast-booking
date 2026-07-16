# csimu DemoCard portal

A Render-ready prepaid card balance simulation with:

- a public balance checker;
- password-protected administrator dashboard;
- generated `DEMO-XXXX-XXXX-XXXX` identifiers;
- one-time six-digit access codes;
- persistent PostgreSQL balances and card status;
- balance-change audit history;
- rate limiting, secure cookies, origin checks, and hashed access codes.

These are synthetic demo cards. The application does not accept payment-card numbers and is not connected to a bank or payment network.

## Environment

Copy `.env.example` and set `DATABASE_URL` and a strong `ADMIN_PASSWORD`. Production secrets belong in Render environment variables and must not be committed.

## Commands

```bash
pnpm install
pnpm check
pnpm test
pnpm start
```

The server creates its PostgreSQL tables and indexes on startup. Render should use `/health` as its health-check path.
