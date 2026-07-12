const form = document.querySelector("#chat-form");
const input = document.querySelector("#message");
const messages = document.querySelector("#messages");
const sessionId = localStorage.aiSessionId ||= crypto.randomUUID();

function add(text, type) {
  const item = document.createElement("article");
  item.className = type;
  item.textContent = text;
  messages.append(item);
  messages.scrollTop = messages.scrollHeight;
  return item;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = input.value.trim();
  if (!message) return;
  add(message, "user");
  input.value = "";
  input.disabled = true;
  const waiting = add("Thinking…", "bot waiting");
  try {
    const response = await fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId, message }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    waiting.textContent = data.answer;
    waiting.classList.remove("waiting");
  } catch (error) {
    waiting.textContent = error.message || "Something went wrong. Please try again.";
    waiting.classList.remove("waiting");
  } finally {
    input.disabled = false;
    input.focus();
  }
});

input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); form.requestSubmit(); }
});
