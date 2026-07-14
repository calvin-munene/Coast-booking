import { recordNvidiaCatalog, recordNvidiaRequest } from "./providerHealth.js";

const conversations = new Map();
const conversationLocks = new Map();
const MAX_TURNS = 12;
const MAX_CONVERSATIONS = 1000;
const CONVERSATION_TTL_MS = 6 * 60 * 60 * 1000;
const REQUEST_DEADLINE_MS = 90 * 1000;
const RETRYABLE_NVIDIA_STATUS = new Set([429, 500, 502, 503, 504]);
const MODEL_CATALOG_TTL_MS = 15 * 60 * 1000;
const MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{1,199}$/;
let discoveredModels = [];
let catalogExpiresAt = 0;
let catalogRefreshPromise = null;
let runtimeEnabledModelIds = null;

const MODEL_DEFINITIONS = [
  {
    id: "meta/llama-3.3-70b-instruct",
    label: "Llama 3.3 70B",
    tag: "GENERAL",
    description: "Strong general reasoning and multilingual chat",
    temperature: 0.4,
    topP: 0.7,
    maxTokens: 1024
  },
  {
    id: "nvidia/llama-3.3-nemotron-super-49b-v1.5",
    label: "Nemotron Super 49B",
    tag: "REASONING",
    description: "NVIDIA reasoning model for complex questions and planning",
    temperature: 0.6,
    topP: 0.95,
    maxTokens: 1024
  },
  {
    id: "meta/llama-3.1-70b-instruct",
    label: "Llama 3.1 70B",
    tag: "BALANCED",
    description: "Reliable assistant for everyday work",
    temperature: 0.4,
    topP: 0.7,
    maxTokens: 1024
  },
  {
    id: "meta/llama-3.1-8b-instruct",
    label: "Llama 3.1 8B",
    tag: "FAST",
    description: "Lower-latency answers for simple tasks",
    temperature: 0.4,
    topP: 0.7,
    maxTokens: 1024
  }
];

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function configuredModelIds() {
  const fromEnvironment = (process.env.NVIDIA_MODELS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const source = runtimeEnabledModelIds?.length
    ? runtimeEnabledModelIds
    : fromEnvironment.length
      ? fromEnvironment
      : MODEL_DEFINITIONS.map(({ id }) => id);
  return [...new Set(source)];
}

function definitionFor(id) {
  return MODEL_DEFINITIONS.find((model) => model.id === id) || {
    id,
    label: id.split("/").at(-1),
    tag: "CUSTOM",
    description: "Configured NVIDIA NIM model",
    temperature: 0.4,
    topP: 0.7,
    maxTokens: 1024
  };
}

function wait(milliseconds, signal) {
  if (!signal) return new Promise((resolve) => setTimeout(resolve, milliseconds));
  if (signal.aborted) return Promise.reject(signal.reason || new DOMException("Aborted", "AbortError"));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason || new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}

function retryDelay(response, attempt) {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.min(seconds * 1000, 5000);
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) return Math.min(Math.max(0, date - Date.now()), 5000);
  }
  return 500 * (2 ** attempt) + Math.floor(Math.random() * 150);
}

async function requestCompletion(url, options, { signal, deadline = Date.now() + REQUEST_DEADLINE_MS } = {}) {
  const startedAt = Date.now();
  const model = (() => {
    try { return JSON.parse(options.body)?.model || null; } catch { return null; }
  })();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      recordNvidiaRequest({ ok: false, latencyMs: Date.now() - startedAt, model });
      throw new DOMException("NVIDIA request timed out", "TimeoutError");
    }
    const timeoutSignal = AbortSignal.timeout(remaining);
    const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
    let response;
    try {
      response = await fetch(url, { ...options, signal: requestSignal });
    } catch (error) {
      if (signal?.aborted || attempt === 2 || Date.now() >= deadline) {
        recordNvidiaRequest({ ok: false, latencyMs: Date.now() - startedAt, model });
        throw error;
      }
      await wait(Math.min(500 * (2 ** attempt), Math.max(0, deadline - Date.now())), signal);
      continue;
    }
    if (response.ok) {
      recordNvidiaRequest({ ok: true, statusCode: response.status, latencyMs: Date.now() - startedAt, model });
      return response;
    }

    const detail = await response.text();
    if (!RETRYABLE_NVIDIA_STATUS.has(response.status) || attempt === 2) {
      const error = new Error(`NVIDIA API returned ${response.status}: ${detail.slice(0, 300)}`);
      error.statusCode = response.status;
      recordNvidiaRequest({ ok: false, statusCode: response.status, latencyMs: Date.now() - startedAt, model });
      throw error;
    }

    const delay = Math.min(retryDelay(response, attempt), Math.max(0, deadline - Date.now()));
    await wait(delay, signal);
  }
  throw new Error("NVIDIA request could not be completed");
}

function modelApiUrl() {
  return `${(process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1").replace(/\/+$/, "")}/models`;
}

function completionApiUrl() {
  return `${(process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1").replace(/\/+$/, "")}/chat/completions`;
}

function catalogEntry(value) {
  const id = typeof value?.id === "string" ? value.id.trim() : "";
  if (!MODEL_ID_PATTERN.test(id)) return null;
  const known = definitionFor(id);
  return {
    id,
    label: known.label,
    tag: known.tag,
    description: known.description,
    ownedBy: typeof value.owned_by === "string" ? value.owned_by.slice(0, 100) : null
  };
}

export async function refreshNvidiaModelCatalog({ force = false, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  if (!force && catalogExpiresAt > now() && discoveredModels.length) {
    return { refreshed: false, cached: true, models: discoveredModels.map((model) => ({ ...model })) };
  }
  if (catalogRefreshPromise) return catalogRefreshPromise;
  catalogRefreshPromise = (async () => {
    const apiKey = required("NVIDIA_API_KEY");
    try {
      const response = await fetchImpl(modelApiUrl(), {
        method: "GET",
        headers: { authorization: `Bearer ${apiKey}`, accept: "application/json" },
        signal: AbortSignal.timeout(10_000)
      });
      if (!response.ok) {
        const error = new Error(`NVIDIA model catalog returned ${response.status}`);
        error.statusCode = response.status;
        throw error;
      }
      const data = await response.json();
      const models = [...new Map((Array.isArray(data?.data) ? data.data : [])
        .map(catalogEntry)
        .filter(Boolean)
        .map((model) => [model.id, model])).values()];
      if (!models.length) throw new Error("NVIDIA model catalog returned no usable model IDs");
      discoveredModels = models;
      catalogExpiresAt = now() + MODEL_CATALOG_TTL_MS;
      recordNvidiaCatalog({ ok: true, modelCount: models.length });
      return { refreshed: true, cached: false, models: models.map((model) => ({ ...model })) };
    } catch (error) {
      recordNvidiaCatalog({ ok: false });
      return {
        refreshed: false,
        cached: Boolean(discoveredModels.length),
        error: "catalog_unavailable",
        models: discoveredModels.map((model) => ({ ...model }))
      };
    } finally {
      catalogRefreshPromise = null;
    }
  })();
  return catalogRefreshPromise;
}

export function discoveredNvidiaModels() {
  return discoveredModels.map((model) => ({ ...model }));
}

export function setRuntimeEnabledModels(modelIds) {
  if (modelIds === null) {
    runtimeEnabledModelIds = null;
    return;
  }
  if (!Array.isArray(modelIds) || !modelIds.length || modelIds.some((id) => !MODEL_ID_PATTERN.test(String(id)))) {
    throw new TypeError("At least one valid enabled NVIDIA model is required");
  }
  runtimeEnabledModelIds = [...new Set(modelIds.map(String))];
}

export function resetNvidiaModelCatalogForTests() {
  discoveredModels = [];
  catalogExpiresAt = 0;
  catalogRefreshPromise = null;
  runtimeEnabledModelIds = null;
}

async function withConversationLock(key, task) {
  const previous = conversationLocks.get(key) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  const queued = previous.then(() => current);
  conversationLocks.set(key, queued);
  await previous;
  try {
    return await task();
  } finally {
    release();
    if (conversationLocks.get(key) === queued) conversationLocks.delete(key);
  }
}

function historyFor(key) {
  const entry = conversations.get(key);
  if (!entry || Date.now() - entry.updatedAt > CONVERSATION_TTL_MS) {
    conversations.delete(key);
    return [];
  }
  return entry.messages;
}

function saveHistory(key, history, text, answer) {
  conversations.set(key, {
    updatedAt: Date.now(),
    messages: [
      ...history,
      { role: "user", content: text },
      { role: "assistant", content: answer }
    ].slice(-MAX_TURNS * 2)
  });
  if (conversations.size > MAX_CONVERSATIONS) {
    const oldest = [...conversations.entries()].sort((a, b) => a[1].updatedAt - b[1].updatedAt)[0]?.[0];
    if (oldest) conversations.delete(oldest);
  }
}

function completionContext(conversationId, text, model) {
  const selectedModel = selectModel(model);
  const modelDefinition = definitionFor(selectedModel);
  const conversationKey = `${conversationId}:${selectedModel}`;
  return { conversationId, selectedModel, modelDefinition, conversationKey, text };
}

function modelUnavailable(error) {
  return Number(error?.statusCode) === 404
    || (Number(error?.statusCode) === 400 && /model.{0,80}(not found|unavailable|not supported|does not exist)/i.test(error?.message || ""));
}

async function completionResponseWithFallback(context, history, apiKey, stream, { signal, deadline, onModelSelected } = {}) {
  await onModelSelected?.(context.selectedModel);
  try {
    const response = await requestCompletion(
      completionApiUrl(),
      completionOptions(context, history, apiKey, stream),
      { signal, deadline }
    );
    return { response, context, history };
  } catch (error) {
    const fallbackModel = defaultModel();
    if (!modelUnavailable(error) || fallbackModel === context.selectedModel) throw error;
    const fallbackContext = completionContext(context.conversationId, context.text, fallbackModel);
    const fallbackHistory = historyFor(fallbackContext.conversationKey);
    await onModelSelected?.(fallbackContext.selectedModel);
    const response = await requestCompletion(
      completionApiUrl(),
      completionOptions(fallbackContext, fallbackHistory, apiKey, stream),
      { signal, deadline }
    );
    return { response, context: fallbackContext, history: fallbackHistory };
  }
}

function completionOptions(context, history, apiKey, stream) {
  return {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      accept: stream ? "text/event-stream" : "application/json"
    },
    body: JSON.stringify({
      model: context.selectedModel,
      messages: [
        { role: "system", content: process.env.SYSTEM_PROMPT || "You are a helpful, concise AI assistant." },
        ...history,
        { role: "user", content: context.text }
      ],
      temperature: context.modelDefinition.temperature,
      top_p: context.modelDefinition.topP,
      max_tokens: context.modelDefinition.maxTokens,
      stream
    })
  };
}

async function consumeNvidiaStream(response, onDelta) {
  if (!response.body) throw new Error("NVIDIA API returned no response stream");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let answer = "";
  let completed = false;

  async function consumeFrame(frame) {
    if (!frame.trim()) return;
    const dataLines = frame
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""));
    if (!dataLines.length) return;
    const payload = dataLines.join("\n").trim();
    if (payload === "[DONE]") {
      completed = true;
      return;
    }
    let event;
    try {
      event = JSON.parse(payload);
    } catch {
      throw new Error("NVIDIA API returned a malformed stream event");
    }
    const delta = event.choices?.[0]?.delta?.content;
    if (typeof delta === "string" && delta) {
      answer += delta;
      await onDelta?.(delta, answer);
    }
  }

  try {
    while (!completed) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop() || "";
      for (const frame of frames) await consumeFrame(frame);
      if (done) break;
    }
    if (buffer.trim()) await consumeFrame(buffer);
  } finally {
    if (!completed) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }

  if (!completed) throw new Error("NVIDIA response stream ended unexpectedly");
  const finalAnswer = answer.trim();
  if (!finalAnswer) throw new Error("NVIDIA API returned an empty response");
  return finalAnswer;
}

export function availableModels() {
  return configuredModelIds().map((id) => {
    const { label, tag, description } = definitionFor(id);
    return { id, label, tag, description };
  });
}

export function defaultModel() {
  const configured = configuredModelIds();
  const preferred = process.env.NVIDIA_MODEL || "meta/llama-3.1-70b-instruct";
  return configured.includes(preferred) ? preferred : configured[0];
}

export function selectModel(requestedModel) {
  const selected = requestedModel || defaultModel();
  if (!configuredModelIds().includes(selected)) {
    throw new Error("That model is not available on this assistant");
  }
  return selected;
}

export function resetConversation(conversationId) {
  const prefix = `${conversationId}:`;
  for (const key of conversations.keys()) {
    if (key.startsWith(prefix)) conversations.delete(key);
  }
}

export async function reply({ conversationId, text, model, signal }) {
  const apiKey = required("NVIDIA_API_KEY");
  const context = completionContext(conversationId, text, model);
  const deadline = Date.now() + REQUEST_DEADLINE_MS;
  return withConversationLock(context.conversationKey, async () => {
    const history = historyFor(context.conversationKey);
    const completed = await completionResponseWithFallback(context, history, apiKey, false, { signal, deadline });
    const { response } = completed;
    const data = await response.json();
    const answer = data.choices?.[0]?.message?.content?.trim();
    if (!answer) throw new Error("NVIDIA API returned an empty response");
    saveHistory(completed.context.conversationKey, completed.history, text, answer);
    return answer;
  });
}

export async function streamReply({ conversationId, text, model, signal, onDelta, onModelSelected }) {
  const apiKey = required("NVIDIA_API_KEY");
  const context = completionContext(conversationId, text, model);
  const deadline = Date.now() + REQUEST_DEADLINE_MS;
  return withConversationLock(context.conversationKey, async () => {
    const history = historyFor(context.conversationKey);
    const completed = await completionResponseWithFallback(context, history, apiKey, true, {
      signal,
      deadline,
      onModelSelected
    });
    const { response } = completed;
    const answer = await consumeNvidiaStream(response, onDelta);
    saveHistory(completed.context.conversationKey, completed.history, text, answer);
    return answer;
  });
}
