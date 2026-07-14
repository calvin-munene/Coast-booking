import test from "node:test";
import assert from "node:assert/strict";
import { availableModels, defaultModel, reply, selectModel, streamReply } from "../src/agent.js";

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
