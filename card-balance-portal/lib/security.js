import crypto from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(crypto.scrypt);

export function normalizeCardId(value) { return String(value ?? "").trim().toUpperCase().replace(/\s+/g, "-"); }
export function isDemoCardId(value) { return /^DEMO-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(value); }
export function generateDemoCardId() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const code = Array.from(crypto.randomBytes(12), (byte) => alphabet[byte % alphabet.length]).join("");
  return `DEMO-${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8)}`;
}
export function generateAccessCode() { return crypto.randomInt(0, 1_000_000).toString().padStart(6, "0"); }
export async function hashSecret(secret, salt = crypto.randomBytes(16).toString("hex")) {
  const derived = await scrypt(secret, salt, 64);
  return { salt, hash: Buffer.from(derived).toString("hex") };
}
export async function verifySecret(secret, salt, expected) {
  const candidate = await hashSecret(secret, salt);
  return safeEqual(candidate.hash, expected);
}
export function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
export function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
