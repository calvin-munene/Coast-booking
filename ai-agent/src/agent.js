const conversations = new Map();
const MAX_TURNS = 12;

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

export async function reply({ conversationId, text }) {
  const apiKey = required("NVIDIA_API_KEY");
  const history = conversations.get(conversationId) || [];
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
      model: process.env.NVIDIA_MODEL || "meta/llama-3.1-70b-instruct",
      messages,
      temperature: 0.4,
      max_tokens: 1024
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

  conversations.set(conversationId, [
    ...history,
    { role: "user", content: text },
    { role: "assistant", content: answer }
  ].slice(-MAX_TURNS * 2));
  return answer;
}
