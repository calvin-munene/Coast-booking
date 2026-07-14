const form = document.querySelector("#chat-form");
const input = document.querySelector("#message");
const messages = document.querySelector("#messages");
const suggestions = document.querySelector("#suggestions");
const sendButton = form.querySelector("button[type='submit']");
const charCount = document.querySelector("#char-count");
const sessionCode = document.querySelector("#session-id");
const networkStatus = document.querySelector("#network-status");
const uptime = document.querySelector("#uptime");
const sessionId = localStorage.aiSessionId ||= crypto.randomUUID();
const startedAt = Date.now();

sessionCode.textContent = sessionId.slice(0, 8).toUpperCase();

function clockTime() {
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
}

function addMessage(text, type) {
  const item = document.createElement("article");
  item.className = `message ${type}`;

  const avatar = document.createElement("span");
  avatar.className = "avatar";
  avatar.setAttribute("aria-hidden", "true");
  avatar.textContent = type.includes("user") ? "YOU" : "AI";

  const bubble = document.createElement("div");
  bubble.className = "bubble";

  const label = document.createElement("span");
  label.className = "message-label";
  label.textContent = `${type.includes("user") ? "OPERATOR" : "NVIDBOT"} // ${clockTime()}`;

  const copy = document.createElement("p");
  copy.textContent = text;

  bubble.append(label, copy);
  item.append(avatar, bubble);
  messages.append(item);
  messages.scrollTop = messages.scrollHeight;
  return { item, copy };
}

function syncComposer() {
  charCount.textContent = `${input.value.length} / 8000`;
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 150)}px`;
}

function setBusy(isBusy) {
  input.disabled = isBusy;
  sendButton.disabled = isBusy;
  sendButton.querySelector("span").textContent = isBusy ? "WAIT" : "RUN";
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = input.value.trim();
  if (!message) return;

  addMessage(message, "user");
  suggestions.hidden = true;
  input.value = "";
  syncComposer();
  setBusy(true);

  const waiting = addMessage("PROCESSING QUERY", "bot waiting");
  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId, message })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    waiting.copy.textContent = data.answer;
    waiting.item.classList.remove("waiting");
  } catch (error) {
    waiting.copy.textContent = error.message || "Connection interrupted. Please try again.";
    waiting.item.classList.remove("waiting");
  } finally {
    messages.scrollTop = messages.scrollHeight;
    setBusy(false);
    input.focus();
  }
});

suggestions.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-prompt]");
  if (!button) return;
  input.value = button.dataset.prompt;
  syncComposer();
  input.focus();
});

input.addEventListener("input", syncComposer);
input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});

function updateNetworkState() {
  networkStatus.textContent = navigator.onLine ? "NETWORK STABLE" : "NETWORK OFFLINE";
}

function updateUptime() {
  const total = Math.floor((Date.now() - startedAt) / 1000);
  const hours = String(Math.floor(total / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
  const seconds = String(total % 60).padStart(2, "0");
  uptime.textContent = `UPTIME ${hours}:${minutes}:${seconds}`;
}

window.addEventListener("online", updateNetworkState);
window.addEventListener("offline", updateNetworkState);
setInterval(updateUptime, 1000);
syncComposer();
updateNetworkState();
updateUptime();
