import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

test("Mini App Telegram mode settings render backend capability state", async () => {
  const source = await fs.readFile(new URL("../public/miniapp.js", import.meta.url), "utf8");
  assert.match(source, /api\("\/api\/telegram\/capabilities"\)/);
  assert.match(source, /telegramCapabilityCard/);
  assert.match(source, /BotFather-controlled features are verified here, not represented as pretend switches/);
  assert.match(source, /Telegram Secretary connections/);
  assert.match(source, /Group Secretary/);
  assert.match(source, /activationPolicy/);
  assert.match(source, /messageStorageEnabled/);
  assert.match(source, /threadIsolationEnabled/);
  assert.match(source, /renderThreads/);
  assert.match(source, /if \(!offline && state\.dashboard\) render\(currentPath\(\)\)/);
});

test("Mini App group management uses durable and live-backed routes", async () => {
  const source = await fs.readFile(new URL("../public/miniapp.js", import.meta.url), "utf8");
  assert.match(source, /api\(admin \? "\/api\/admin\/groups\?limit=100" : "\/api\/groups\?limit=100"\)/);
  assert.match(source, /api\(`\/api\/groups\/\$\{chatId\}`\)/);
  assert.match(source, /api\(`\/api\/groups\/\$\{chatId\}\/settings`/);
  assert.match(source, /Always On allows Nvid AI to respond without an explicit mention/);
  assert.match(source, /Verified permissions/);
  assert.match(source, /Recent logs/);
});
