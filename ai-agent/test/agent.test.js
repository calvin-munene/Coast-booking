import test from "node:test";
import assert from "node:assert/strict";
import {
  availableModels,
  defaultModel,
  discoveredNvidiaModels,
  refreshNvidiaModelCatalog,
  reply,
  resetNvidiaModelCatalogForTests,
  selectModel,
  setRuntimeEnabledModels,
  streamReply
} from "../src/agent.js";

test("exposes an approved NVIDIA model catalog", () => {
  const previousModel = process.env.NVIDIA_MODEL;
  const previousModels = process.env.NVIDIA_MODELS;
  process.env.NVIDIA_MODEL = "meta/llama-3.1-70b-instruct";
  delete process.env.NVIDIA_MODELS;

  const models = availableModels();
  assert.equal(defaultModel(), "meta/llama-3.1-70b-instruct");
  assert.ok(models.length >= 4);
  assert.ok(models.every(({ id, label, tag }) => id && label && tag));
  assert.equal(selectModel("meta/llama-3.3-70b-instruct"), "meta/llama-3.3-70b-instruct");
  assert.throws(() => selectModel("unknown/unapproved-model"), /not available/);

  if (previousModel === undefined) delete process.env.NVIDIA_MODEL;
  else process.env.NVIDIA_MODEL = previousModel;
  if (previousModels === undefined) delete process.env.NVIDIA_MODELS;
  else process.env.NVIDIA_MODELS = previousModels;
});

test("supports an administrator-configured model allowlist", () => {
  const previousModel = process.env.NVIDIA_MODEL;
  const previousModels = process.env.NVIDIA_MODELS;
  process.env.NVIDIA_MODEL = "meta/llama-3.3-70b-instruct";
  process.env.NVIDIA_MODELS = "nvidia/llama-3.3-nemotron-super-49b-v1.5";

  assert.deepEqual(availableModels().map(({ id }) => id), ["nvidia/llama-3.3-nemotron-super-49b-v1.5"]);
  assert.equal(defaultModel(), "nvidia/llama-3.3-nemotron-super-49b-v1.5");
  assert.throws(() => selectModel("meta/llama-3.3-70b-instruct"), /not available/);

  if (previousModel === undefined) delete process.env.NVIDIA_MODEL;
  else process.env.NVIDIA_MODEL = previousModel;
  if (previousModels === undefined) delete process.env.NVIDIA_MODELS;
  else process.env.NVIDIA_MODELS = previousModels;
});

test("sends the selected approved model to NVIDIA", async () => {
  const previousKey = process.env.NVIDIA_API_KEY;
  const previousModel = process.env.NVIDIA_MODEL;
  const previousModels = process.env.NVIDIA_MODELS;
  const previousFetch = globalThis.fetch;
  process.env.NVIDIA_API_KEY = "test-key";
  process.env.NVIDIA_MODEL = "meta/llama-3.1-70b-instruct";
  delete process.env.NVIDIA_MODELS;
  let requestBody;
  globalThis.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return new Response(JSON.stringify({ choices: [{ message: { content: "selected model works" } }] }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };

  const answer = await reply({
    conversationId: "test-model-selection",
    text: "hello",
    model: "nvidia/llama-3.3-nemotron-super-49b-v1.5"
  });

  assert.equal(answer, "selected model works");
  assert.equal(requestBody.model, "nvidia/llama-3.3-nemotron-super-49b-v1.5");
  assert.equal(requestBody.temperature, 0.6);

  globalThis.fetch = previousFetch;
  if (previousKey === undefined) delete process.env.NVIDIA_API_KEY;
  else process.env.NVIDIA_API_KEY = previousKey;
  if (previousModel === undefined) delete process.env.NVIDIA_MODEL;
  else process.env.NVIDIA_MODEL = previousModel;
  if (previousModels === undefined) delete process.env.NVIDIA_MODELS;
  else process.env.NVIDIA_MODELS = previousModels;
});

test("retries temporary NVIDIA capacity errors", async () => {
  const previousKey = process.env.NVIDIA_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.NVIDIA_API_KEY = "test-key";
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    if (requests === 1) {
      return new Response("busy", { status: 503, headers: { "retry-after": "0" } });
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: "recovered" } }] }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };

  const answer = await reply({ conversationId: "test-retry", text: "hello" });
  assert.equal(answer, "recovered");
  assert.equal(requests, 2);

  globalThis.fetch = previousFetch;
  if (previousKey === undefined) delete process.env.NVIDIA_API_KEY;
  else process.env.NVIDIA_API_KEY = previousKey;
});

test("parses NVIDIA SSE across arbitrary UTF-8 chunk boundaries", async () => {
  const previousKey = process.env.NVIDIA_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.NVIDIA_API_KEY = "test-key";
  let requestBody;
  const source = [
    ': keepalive',
    '',
    'data: {"choices":[{"delta":{"role":"assistant"}}]}',
    '',
    'data: {"choices":[{"delta":{"content":"Hello "}}]}',
    '',
    'data: {"choices":[{"delta":{"content":"\u{1F30D}"}}]}',
    '',
    'data: [DONE]',
    ''
  ].join("\r\n");
  const encoded = new TextEncoder().encode(source);
  globalThis.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return new Response(new ReadableStream({
      start(controller) {
        for (const boundary of [7, 31, 79, encoded.length - 2, encoded.length]) {
          const start = this.offset || 0;
          if (boundary > start) controller.enqueue(encoded.slice(start, boundary));
          this.offset = boundary;
        }
        controller.close();
      }
    }), { status: 200, headers: { "content-type": "text/event-stream" } });
  };

  const deltas = [];
  const answer = await streamReply({
    conversationId: "test-stream-boundaries",
    text: "hello",
    onDelta: (delta) => deltas.push(delta)
  });

  assert.equal(requestBody.stream, true);
  assert.equal(answer, "Hello \u{1F30D}");
  assert.deepEqual(deltas, ["Hello ", "\u{1F30D}"]);

  globalThis.fetch = previousFetch;
  if (previousKey === undefined) delete process.env.NVIDIA_API_KEY;
  else process.env.NVIDIA_API_KEY = previousKey;
});

test("rejects an incomplete NVIDIA stream", async () => {
  const previousKey = process.env.NVIDIA_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.NVIDIA_API_KEY = "test-key";
  globalThis.fetch = async () => new Response(
    'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n',
    { status: 200, headers: { "content-type": "text/event-stream" } }
  );

  await assert.rejects(
    streamReply({ conversationId: "test-incomplete-stream", text: "hello" }),
    /ended unexpectedly/
  );

  globalThis.fetch = previousFetch;
  if (previousKey === undefined) delete process.env.NVIDIA_API_KEY;
  else process.env.NVIDIA_API_KEY = previousKey;
});

test("discovers NVIDIA models with a bounded cache while admin controls remain authoritative", async () => {
  const previousKey = process.env.NVIDIA_API_KEY;
  const previousBase = process.env.NVIDIA_BASE_URL;
  const previousModels = process.env.NVIDIA_MODELS;
  process.env.NVIDIA_API_KEY = "test-key";
  process.env.NVIDIA_BASE_URL = "https://nvidia.example/v1/";
  delete process.env.NVIDIA_MODELS;
  resetNvidiaModelCatalogForTests();
  let calls = 0;
  const fetchImpl = async (url, options) => {
    calls += 1;
    assert.equal(url, "https://nvidia.example/v1/models");
    assert.match(options.headers.authorization, /^Bearer /);
    return new Response(JSON.stringify({
      data: [
        { id: "meta/new-chat-model", owned_by: "meta" },
        { id: "meta/new-chat-model", owned_by: "duplicate" },
        { id: "invalid model id" }
      ]
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  const refreshed = await refreshNvidiaModelCatalog({ force: true, fetchImpl });
  assert.equal(refreshed.refreshed, true);
  assert.deepEqual(discoveredNvidiaModels().map(({ id }) => id), ["meta/new-chat-model"]);
  const cached = await refreshNvidiaModelCatalog({ fetchImpl });
  assert.equal(cached.cached, true);
  assert.equal(calls, 1);

  setRuntimeEnabledModels(["meta/new-chat-model"]);
  assert.deepEqual(availableModels().map(({ id }) => id), ["meta/new-chat-model"]);

  resetNvidiaModelCatalogForTests();
  if (previousKey === undefined) delete process.env.NVIDIA_API_KEY;
  else process.env.NVIDIA_API_KEY = previousKey;
  if (previousBase === undefined) delete process.env.NVIDIA_BASE_URL;
  else process.env.NVIDIA_BASE_URL = previousBase;
  if (previousModels === undefined) delete process.env.NVIDIA_MODELS;
  else process.env.NVIDIA_MODELS = previousModels;
});

test("falls back once when NVIDIA reports that the selected model is unavailable", async () => {
  const previousKey = process.env.NVIDIA_API_KEY;
  const previousModel = process.env.NVIDIA_MODEL;
  const previousModels = process.env.NVIDIA_MODELS;
  const previousFetch = globalThis.fetch;
  process.env.NVIDIA_API_KEY = "test-key";
  process.env.NVIDIA_MODEL = "meta/fallback-model";
  process.env.NVIDIA_MODELS = "meta/fallback-model,meta/unavailable-model";
  const requestedModels = [];
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    requestedModels.push(body.model);
    if (body.model === "meta/unavailable-model") {
      return new Response(JSON.stringify({ error: "model not found" }), {
        status: 404,
        headers: { "content-type": "application/json" }
      });
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: "fallback answer" } }] }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };

  const answer = await reply({
    conversationId: "fallback-test",
    text: "hello",
    model: "meta/unavailable-model"
  });
  assert.equal(answer, "fallback answer");
  assert.deepEqual(requestedModels, ["meta/unavailable-model", "meta/fallback-model"]);

  globalThis.fetch = previousFetch;
  if (previousKey === undefined) delete process.env.NVIDIA_API_KEY;
  else process.env.NVIDIA_API_KEY = previousKey;
  if (previousModel === undefined) delete process.env.NVIDIA_MODEL;
  else process.env.NVIDIA_MODEL = previousModel;
  if (previousModels === undefined) delete process.env.NVIDIA_MODELS;
  else process.env.NVIDIA_MODELS = previousModels;
});
