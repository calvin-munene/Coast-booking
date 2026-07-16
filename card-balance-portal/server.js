import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cookieParser from "cookie-parser";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import pg from "pg";
import { generateAccessCode, generateDemoCardId, hashSecret, isDemoCardId, normalizeCardId, safeEqual, sha256, verifySecret } from "./lib/security.js";

const { Pool } = pg;
const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3000);
const databaseUrl = process.env.DATABASE_URL;
const adminPassword = process.env.ADMIN_PASSWORD;

if (!databaseUrl) throw new Error("DATABASE_URL is required");
if (!adminPassword || adminPassword.length < 12) throw new Error("ADMIN_PASSWORD must contain at least 12 characters");

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: /localhost|127\.0\.0\.1/.test(databaseUrl) ? false : { rejectUnauthorized: false },
  max: 8,
  idleTimeoutMillis: 30_000,
});

await initializeDatabase();

const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
    },
  },
}));
app.use(express.json({ limit: "16kb" }));
app.use(cookieParser());
app.use("/assets", express.static(path.join(root, "app"), { maxAge: "1h", immutable: false }));
app.use(express.static(path.join(root, "public"), { extensions: ["html"], maxAge: "5m" }));

const balanceLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many attempts. Wait ten minutes and try again." },
});
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 6,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many login attempts. Wait fifteen minutes and try again." },
});

app.get("/health", async (_request, response) => {
  try {
    await pool.query("SELECT 1");
    response.json({ status: "ok" });
  } catch {
    response.status(503).json({ status: "unavailable" });
  }
});

app.get("/admin", requireAdminPage, (_request, response) => response.sendFile(path.join(root, "public", "admin.html")));
app.get("/login", (_request, response) => response.sendFile(path.join(root, "public", "login.html")));

app.post("/api/check", balanceLimiter, async (request, response) => {
  const publicId = normalizeCardId(request.body?.cardId);
  const accessCode = String(request.body?.accessCode ?? "").replace(/\D/g, "");
  if (!isDemoCardId(publicId) || !/^\d{6}$/.test(accessCode)) return invalidCard(response);

  const result = await pool.query(
    `SELECT id, public_id, label, access_salt, access_hash, balance_minor, currency, status, expires_at, updated_at
       FROM demo_cards WHERE public_id = $1 LIMIT 1`,
    [publicId],
  );
  const card = result.rows[0];
  if (!card || !(await verifySecret(accessCode, card.access_salt, card.access_hash))) return invalidCard(response);

  const expired = card.expires_at && new Date(card.expires_at) < new Date();
  response.set("Cache-Control", "no-store").json({
    card: {
      publicId: card.public_id,
      label: card.label,
      balanceMinor: Number(card.balance_minor),
      currency: card.currency,
      status: expired ? "expired" : card.status,
      expiresAt: card.expires_at,
      updatedAt: card.updated_at,
    },
  });
});

app.post("/api/admin/login", loginLimiter, requireSameOrigin, async (request, response) => {
  const supplied = String(request.body?.password ?? "");
  if (!safeEqual(sha256(supplied), sha256(adminPassword))) {
    return response.status(401).json({ error: "Incorrect administrator password." });
  }
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000);
  await pool.query("DELETE FROM admin_sessions WHERE expires_at < NOW()");
  await pool.query("INSERT INTO admin_sessions (token_hash, expires_at) VALUES ($1, $2)", [sha256(token), expiresAt]);
  response.cookie("csimu_admin", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 8 * 60 * 60 * 1000,
    path: "/",
  }).json({ ok: true });
});

app.post("/api/admin/logout", requireSameOrigin, requireAdminApi, async (request, response) => {
  const token = request.cookies.csimu_admin;
  if (token) await pool.query("DELETE FROM admin_sessions WHERE token_hash = $1", [sha256(token)]);
  response.clearCookie("csimu_admin", { path: "/" }).json({ ok: true });
});

app.get("/api/admin/me", requireAdminApi, (_request, response) => response.json({ authenticated: true }));

app.get("/api/admin/cards", requireAdminApi, async (_request, response) => {
  const result = await pool.query(
    `SELECT id, public_id, label, balance_minor, currency, status, expires_at, created_at, updated_at
       FROM demo_cards ORDER BY created_at DESC LIMIT 200`,
  );
  response.set("Cache-Control", "no-store").json({ cards: result.rows.map(toPublicCard) });
});

app.post("/api/admin/cards", requireSameOrigin, requireAdminApi, async (request, response) => {
  const label = String(request.body?.label ?? "").trim().slice(0, 60);
  const balance = Number(request.body?.balance);
  const expiresAt = request.body?.expiresAt ? new Date(request.body.expiresAt) : null;
  if (!label) return response.status(400).json({ error: "Card label is required." });
  if (!Number.isFinite(balance) || balance < 0 || balance > 10_000_000) {
    return response.status(400).json({ error: "Enter a balance from KES 0 to KES 10,000,000." });
  }
  if (expiresAt && Number.isNaN(expiresAt.getTime())) return response.status(400).json({ error: "Enter a valid expiry date." });

  const publicId = generateDemoCardId();
  const accessCode = generateAccessCode();
  const { salt, hash } = await hashSecret(accessCode);
  const result = await pool.query(
    `INSERT INTO demo_cards (public_id, label, access_salt, access_hash, balance_minor, currency, status, expires_at)
     VALUES ($1, $2, $3, $4, $5, 'KES', 'active', $6)
     RETURNING id, public_id, label, balance_minor, currency, status, expires_at, created_at, updated_at`,
    [publicId, label, salt, hash, Math.round(balance * 100), expiresAt],
  );
  response.set("Cache-Control", "no-store").status(201).json({ card: toPublicCard(result.rows[0]), accessCode });
});

app.patch("/api/admin/cards/:id", requireSameOrigin, requireAdminApi, async (request, response) => {
  const id = Number(request.params.id);
  if (!Number.isInteger(id) || id < 1) return response.status(400).json({ error: "Invalid card." });
  const balance = request.body?.balance === undefined ? undefined : Number(request.body.balance);
  const status = request.body?.status;
  if (balance !== undefined && (!Number.isFinite(balance) || balance < 0 || balance > 10_000_000)) {
    return response.status(400).json({ error: "Enter a balance from KES 0 to KES 10,000,000." });
  }
  if (status !== undefined && !["active", "frozen"].includes(status)) return response.status(400).json({ error: "Invalid status." });
  if (balance === undefined && status === undefined) return response.status(400).json({ error: "No changes supplied." });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query("SELECT * FROM demo_cards WHERE id = $1 FOR UPDATE", [id]);
    if (!existing.rows[0]) {
      await client.query("ROLLBACK");
      return response.status(404).json({ error: "Card not found." });
    }
    const oldCard = existing.rows[0];
    const newMinor = balance === undefined ? Number(oldCard.balance_minor) : Math.round(balance * 100);
    const newStatus = status ?? oldCard.status;
    const updated = await client.query(
      `UPDATE demo_cards SET balance_minor = $1, status = $2, updated_at = NOW() WHERE id = $3
       RETURNING id, public_id, label, balance_minor, currency, status, expires_at, created_at, updated_at`,
      [newMinor, newStatus, id],
    );
    if (newMinor !== Number(oldCard.balance_minor)) {
      await client.query(
        `INSERT INTO balance_events (card_id, previous_minor, new_minor, reason)
         VALUES ($1, $2, $3, $4)`,
        [id, oldCard.balance_minor, newMinor, String(request.body?.reason ?? "Administrator adjustment").slice(0, 120)],
      );
    }
    await client.query("COMMIT");
    response.json({ card: toPublicCard(updated.rows[0]) });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

app.use("/api", (_request, response) => response.status(404).json({ error: "Not found." }));
app.use((error, _request, response, _next) => {
  console.error("Request failed", error instanceof Error ? error.message : "Unknown error");
  response.status(500).json({ error: "The service is temporarily unavailable." });
});

const server = app.listen(port, "0.0.0.0", () => console.log(`csimu listening on ${port}`));
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => server.close(async () => { await pool.end(); process.exit(0); }));
}

async function initializeDatabase() {
  await pool.query(`CREATE TABLE IF NOT EXISTS demo_cards (
    id BIGSERIAL PRIMARY KEY,
    public_id TEXT UNIQUE NOT NULL,
    label TEXT NOT NULL,
    access_salt TEXT NOT NULL,
    access_hash TEXT NOT NULL,
    balance_minor BIGINT NOT NULL DEFAULT 0 CHECK (balance_minor >= 0),
    currency TEXT NOT NULL DEFAULT 'KES',
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','frozen')),
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query("CREATE INDEX IF NOT EXISTS demo_cards_created_at_idx ON demo_cards (created_at DESC)");
  await pool.query(`CREATE TABLE IF NOT EXISTS balance_events (
    id BIGSERIAL PRIMARY KEY,
    card_id BIGINT NOT NULL REFERENCES demo_cards(id) ON DELETE CASCADE,
    previous_minor BIGINT NOT NULL,
    new_minor BIGINT NOT NULL,
    reason TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS admin_sessions (
    token_hash TEXT PRIMARY KEY,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
}

async function requireAdminPage(request, response, next) {
  if (await validSession(request.cookies.csimu_admin)) return next();
  return response.redirect(303, "/login");
}
async function requireAdminApi(request, response, next) {
  if (await validSession(request.cookies.csimu_admin)) return next();
  return response.status(401).json({ error: "Administrator login required." });
}
async function validSession(token) {
  if (!token || token.length > 100) return false;
  const result = await pool.query("SELECT 1 FROM admin_sessions WHERE token_hash = $1 AND expires_at > NOW()", [sha256(token)]);
  return result.rowCount === 1;
}
function requireSameOrigin(request, response, next) {
  const origin = request.get("origin");
  const expected = `${request.protocol}://${request.get("host")}`;
  if (!origin || origin !== expected) return response.status(403).json({ error: "Invalid request origin." });
  next();
}
function invalidCard(response) { return response.status(404).json({ error: "Card ID or access code is incorrect." }); }
function toPublicCard(row) {
  return {
    id: Number(row.id), publicId: row.public_id, label: row.label,
    balanceMinor: Number(row.balance_minor), currency: row.currency, status: row.status,
    expiresAt: row.expires_at, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}
