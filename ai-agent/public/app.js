const form = document.querySelector("#chat-form");
const input = document.querySelector("#message");
const messages = document.querySelector("#messages");
const suggestions = document.querySelector("#suggestions");
const sendButton = form.querySelector("button[type='submit']");
const charCount = document.querySelector("#char-count");
const sessionCode = document.querySelector("#session-id");
const networkStatus = document.querySelector("#network-status");
const uptime = document.querySelector("#uptime");
const modelSelect = document.querySelector("#model-select");
const activeModel = document.querySelector("#active-model");
const sessionId = localStorage.aiSessionId ||= crypto.randomUUID();
const startedAt = Date.now();
const modelsById = new Map();

sessionCode.textContent = sessionId.slice(0, 8).toUpperCase();

function clockTime() {
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
}

function selectedModelLabel(modelId = modelSelect.value) {
  return modelsById.get(modelId)?.label || "NVIDIA AI";
}

function updateActiveModel() {
  const model = modelsById.get(modelSelect.value);
  activeModel.textContent = model ? `${model.label} / ${model.tag}` : "NVIDIA DEFAULT";
  if (model) modelSelect.title = model.description;
}

async function loadModels() {
  try {
    const response = await fetch("/api/models", { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error("Model catalog unavailable");
    const data = await response.json();
    modelSelect.replaceChildren();
    for (const model of data.models) {
      modelsById.set(model.id, model);
      const option = document.createElement("option");
      option.value = model.id;
      option.textContent = `${model.label} // ${model.tag}`;
      option.title = model.description;
      modelSelect.append(option);
    }
    const savedModel = localStorage.nvidbotModel;
    modelSelect.value = modelsById.has(savedModel) ? savedModel : data.defaultModel;
    modelSelect.disabled = false;
    updateActiveModel();
  } catch {
    modelSelect.replaceChildren(new Option("NVIDIA DEFAULT", ""));
    activeModel.textContent = "NVIDIA DEFAULT";
  }
}

function addMessage(text, type, modelLabel = "") {
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
  const source = type.includes("user") ? "OPERATOR" : modelLabel || "NVIDBOT";
  label.textContent = `${source.toUpperCase()} // ${clockTime()}`;

  const copy = document.createElement("p");
  copy.textContent = text;

  bubble.append(label, copy);
  item.append(avatar, bubble);
  messages.append(item);
  messages.scrollTop = messages.scrollHeight;
  return { item, copy, label };
}

function syncComposer() {
  charCount.textContent = `${input.value.length} / 8000`;
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 150)}px`;
}

function setBusy(isBusy) {
  input.disabled = isBusy;
  modelSelect.disabled = isBusy || modelsById.size === 0;
  sendButton.disabled = isBusy;
  sendButton.querySelector("span").textContent = isBusy ? "WAIT" : "RUN";
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = input.value.trim();
  if (!message) return;

  const requestedModel = modelSelect.value || undefined;
  const requestedLabel = selectedModelLabel(requestedModel);
  addMessage(message, "user");
  suggestions.hidden = true;
  input.value = "";
  syncComposer();
  setBusy(true);

  const waiting = addMessage("PROCESSING QUERY", "bot waiting", requestedLabel);
  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId, message, model: requestedModel })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    waiting.copy.textContent = data.answer;
    waiting.label.textContent = `${selectedModelLabel(data.model).toUpperCase()} // ${clockTime()}`;
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

modelSelect.addEventListener("change", () => {
  localStorage.nvidbotModel = modelSelect.value;
  updateActiveModel();
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

function startHackerField(canvas) {
  const context = canvas?.getContext("2d", { alpha: true });
  if (!context) return;

  const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
  let width = 0;
  let height = 0;
  let nodes = [];
  let frame = 0;
  let running = false;
  let lastDraw = 0;

  function createNodes() {
    const lowPower = width < 700 || (navigator.hardwareConcurrency || 8) <= 4;
    const maximum = lowPower ? 38 : 68;
    const count = Math.max(30, Math.min(maximum, Math.round((width * height) / 26000)));
    nodes = Array.from({ length: count }, (_, index) => ({
      x: (Math.random() - 0.5) * 980,
      y: (Math.random() - 0.5) * 720,
      z: (Math.random() - 0.5) * 620,
      phase: Math.random() * Math.PI * 2,
      code: index % 17 === 0 ? `0x${Math.floor(Math.random() * 65535).toString(16).padStart(4, "0")}` : ""
    }));
  }

  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    const ratioLimit = width * height > 2_500_000 ? 1 : 1.5;
    const ratio = Math.min(window.devicePixelRatio || 1, ratioLimit);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    createNodes();
    if (motionPreference.matches) draw(1800);
  }

  function project(node, time) {
    const yaw = time * 0.000075;
    const pitch = Math.sin(time * 0.00017) * 0.16;
    const cosY = Math.cos(yaw);
    const sinY = Math.sin(yaw);
    const cosX = Math.cos(pitch);
    const sinX = Math.sin(pitch);
    const rotatedX = node.x * cosY - node.z * sinY;
    const rotatedZ = node.x * sinY + node.z * cosY;
    const driftY = node.y + Math.sin(time * 0.00045 + node.phase) * 18;
    const rotatedY = driftY * cosX - rotatedZ * sinX;
    const depth = driftY * sinX + rotatedZ * cosX + 840;
    const scale = 640 / depth;
    return {
      x: width * 0.57 + rotatedX * scale,
      y: height * 0.5 + rotatedY * scale,
      scale,
      depth,
      code: node.code,
      visible: depth > 280 && scale > 0
    };
  }

  function draw(time) {
    context.clearRect(0, 0, width, height);
    const points = nodes.map((node) => project(node, time));

    const glow = context.createRadialGradient(width * 0.68, height * 0.48, 0, width * 0.68, height * 0.48, Math.max(width, height) * 0.56);
    glow.addColorStop(0, "rgba(112, 211, 26, 0.075)");
    glow.addColorStop(0.45, "rgba(74, 140, 14, 0.025)");
    glow.addColorStop(1, "rgba(0, 0, 0, 0)");
    context.fillStyle = glow;
    context.fillRect(0, 0, width, height);

    context.lineWidth = 0.6;
    for (let first = 0; first < points.length; first += 1) {
      const a = points[first];
      if (!a.visible) continue;
      for (let second = first + 1; second < points.length; second += 1) {
        const b = points[second];
        if (!b.visible) continue;
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        if (distance > 138) continue;
        const alpha = Math.max(0, (1 - distance / 138) * Math.min(a.scale, b.scale) * 0.2);
        context.strokeStyle = `rgba(142, 234, 34, ${alpha})`;
        context.beginPath();
        context.moveTo(a.x, a.y);
        context.lineTo(b.x, b.y);
        context.stroke();
      }
    }

    context.font = "8px ui-monospace, monospace";
    for (const point of points) {
      if (!point.visible || point.x < -30 || point.x > width + 30 || point.y < -30 || point.y > height + 30) continue;
      const alpha = Math.min(0.62, Math.max(0.08, point.scale * 0.34));
      context.fillStyle = `rgba(168, 255, 79, ${alpha})`;
      context.beginPath();
      context.arc(point.x, point.y, Math.max(0.5, point.scale * 1.5), 0, Math.PI * 2);
      context.fill();
      if (point.code && width > 700) {
        context.fillStyle = `rgba(142, 234, 34, ${alpha * 0.52})`;
        context.fillText(point.code, point.x + 8, point.y - 7);
      }
    }

    const pulse = 1 + Math.sin(time * 0.0012) * 0.035;
    const centerX = width * 0.78;
    const centerY = height * 0.48;
    context.strokeStyle = "rgba(142, 234, 34, 0.08)";
    context.lineWidth = 1;
    for (let ring = 1; ring <= 3; ring += 1) {
      context.beginPath();
      context.ellipse(centerX, centerY, ring * 74 * pulse, ring * 38 * pulse, -0.18, 0, Math.PI * 2);
      context.stroke();
    }
    context.strokeStyle = "rgba(182, 255, 92, 0.14)";
    context.beginPath();
    context.moveTo(centerX - 16, centerY);
    context.lineTo(centerX + 16, centerY);
    context.moveTo(centerX, centerY - 16);
    context.lineTo(centerX, centerY + 16);
    context.stroke();
  }

  function tick(time) {
    if (!running) return;
    if (time - lastDraw >= 32) {
      draw(time);
      lastDraw = time;
    }
    frame = requestAnimationFrame(tick);
  }

  function stop() {
    running = false;
    cancelAnimationFrame(frame);
  }

  function start() {
    if (running || motionPreference.matches || document.hidden) return;
    running = true;
    frame = requestAnimationFrame(tick);
  }

  window.addEventListener("resize", resize, { passive: true });
  document.addEventListener("visibilitychange", () => document.hidden ? stop() : start());
  motionPreference.addEventListener?.("change", () => {
    if (motionPreference.matches) {
      stop();
      draw(1800);
    } else {
      start();
    }
  });

  resize();
  start();
}

window.addEventListener("online", updateNetworkState);
window.addEventListener("offline", updateNetworkState);
setInterval(updateUptime, 1000);
syncComposer();
updateNetworkState();
updateUptime();
loadModels();
startHackerField(document.querySelector("#hacker-canvas"));
