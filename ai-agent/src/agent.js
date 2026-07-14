const conversations = new Map();
const MAX_TURNS = 12;
const RETRYABLE_NVIDIA_STATUS = new Set([429, 502, 503, 504]);

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
  return [...new Set(fromEnvironment.length ? fromEnvironment : MODEL_DEFINITIONS.map(({ id }) => id))];
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

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function requestCompletion(url, options) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(url, { ...options, signal: AbortSignal.timeout(60000) });
    if (response.ok) return response;

    const detail = await response.text();
    if (!RETRYABLE_NVIDIA_STATUS.has(response.status) || attempt === 2) {
      const error = new Error(`NVIDIA API returned ${response.status}: ${detail.slice(0, 300)}`);
      error.statusCode = response.status;
      throw error;
    }

    const retryAfterSeconds = Number(response.headers.get("retry-after"));
    const delay = Number.isFinite(retryAfterSeconds)
      ? Math.min(retryAfterSeconds * 1000, 5000)
      : 500 * (2 ** attempt);
    await wait(delay);
  }
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

export async function reply({ conversationId, text, model }) {
  const apiKey = required("NVIDIA_API_KEY");
  const selectedModel = selectModel(model);
  const modelDefinition = definitionFor(selectedModel);
  const conversationKey = `${conversationId}:${selectedModel}`;
  const history = conversations.get(conversationKey) || [];
  const messages = [
    { role: "system", content: process.env.SYSTEM_PROMPT || "You are a helpful, concise AI assistant." },
    ...history,
    { role: "user", content: text }
  ];

  const response = await requestCompletion(`${process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1"}/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: selectedModel,
      messages,
      temperature: modelDefinition.temperature,
      top_p: modelDefinition.topP,
      max_tokens: modelDefinition.maxTokens
    })
  });

  const data = await response.json();
  const answer = data.choices?.[0]?.message?.content?.trim();
  if (!answer) throw new Error("NVIDIA API returned an empty response");

  conversations.set(conversationKey, [
    ...history,
    { role: "user", content: text },
    { role: "assistant", content: answer }
  ].slice(-MAX_TURNS * 2));
  return answer;
}
