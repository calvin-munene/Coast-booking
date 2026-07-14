const conversations = new Map();
const MAX_TURNS = 12;

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
    id: "openai/gpt-oss-120b",
    label: "GPT-OSS 120B",
    tag: "REASONING",
    description: "Deep reasoning for complex questions",
    temperature: 1,
    topP: 1,
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

  const response = await fetch(`${process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1"}/chat/completions`, {
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
    }),
    signal: AbortSignal.timeout(60000)
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`NVIDIA API returned ${response.status}: ${detail.slice(0, 300)}`);
  }

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
