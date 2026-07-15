const tg = window.Telegram?.WebApp;
const app = document.getElementById("app");
const toast = document.getElementById("toast");
const offlineBanner = document.getElementById("offline-banner");
const connectionState = document.getElementById("connection-state");
const backButton = document.getElementById("back-button");
const state = {
  session: sessionStorage.getItem("nvidbotTelegramSession") || "",
  dashboard: null,
  botLink: "/",
  chatAbort: null
};

const unavailableRoutes = {
  "/groups": ["Groups", "Add Nvid AI to a group and promote it with the permissions you want it to use. Managed groups will appear after Telegram sends the bot group events.", "Group administrator permissions"],
  "/moderation": ["Moderation", "Moderation controls require Nvid AI to be an administrator in the target group. No action is shown as available until Telegram confirms the permissions.", "Delete and restrict permissions"],
  "/bots": ["Bot Manager", "Managed bot credentials remain disabled until encrypted credential storage is configured by the platform administrator.", "Encryption key and role access"],
  "/guard": ["Guard", "Guard join-request controls work only in groups where Guard Mode is enabled and the bot can invite users.", "can_invite_users permission"],
  "/secretary": ["Secretary", "Secretary features only process messages Telegram delivers to Nvid AI. The bot cannot read arbitrary private conversations.", "Bot-visible message history"],
  "/threads": ["Threads", "Thread context is isolated by group, forum topic, and user. Add the bot to a forum group to activate topic controls.", "Forum topics and group access"],
  "/admin/users": ["User Management", "User search and role-management APIs are not enabled in this deployment yet. Existing /ban and /unban controls remain available in Telegram.", "Platform user-management rollout"],
  "/admin/groups": ["Group Administration", "Group administration appears only after a group grants the bot live Telegram administrator permissions.", "Test group setup"]
};

function node(tag, attributes = {}, children = []) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined || value === null) continue;
    if (key === "className") element.className = value;
    else if (key === "text") element.textContent = value;
    else if (key.startsWith("on") && typeof value === "function") element.addEventListener(key.slice(2).toLowerCase(), value);
    else element.setAttribute(key, String(value));
  }
  for (const child of Array.isArray(children) ? children : [children]) {
    if (child === undefined || child === null) continue;
    element.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return element;
}

function requestId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function showToast(message) {
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { toast.hidden = true; }, 3200);
}

function haptic(type = "light") {
  if (tg?.isVersionAtLeast?.("6.1")) tg.HapticFeedback?.impactOccurred?.(type);
}

async function api(path, { method = "GET", body, signal } = {}) {
  const response = await fetch(path, {
    method,
    signal,
    headers: {
      accept: "application/json",
      ...(body ? { "content-type": "application/json" } : {}),
      ...(state.session ? { authorization: `Bearer ${state.session}` } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) {
    sessionStorage.removeItem("nvidbotTelegramSession");
    state.session = "";
  }
  if (!response.ok) throw Object.assign(new Error(data.error || `Request failed (${response.status})`), { status: response.status });
  return data;
}

async function authenticate() {
  const launch = async (useSession) => api("/api/miniapp/state", {
    method: "POST",
    body: useSession ? {} : { initData: tg?.initData || "" }
  });
  let result;
  try {
    result = await launch(Boolean(state.session));
  } catch (error) {
    if (!state.session && error.status !== 401) throw error;
    state.session = "";
    sessionStorage.removeItem("nvidbotTelegramSession");
    result = await launch(false);
  }
  if (result.sessionToken) {
    state.session = result.sessionToken;
    sessionStorage.setItem("nvidbotTelegramSession", result.sessionToken);
  }
  state.dashboard = result.dashboard;
  state.botLink = result.dashboard.telegram?.link || "/";
}

function pageHead(title, description, eyebrow = "NVID AI OPERATING SYSTEM") {
  return node("header", { className: "page-head" }, [
    node("div", {}, [
      node("p", { text: eyebrow }),
      node("h1", { text: title }),
      node("p", { className: "subcopy", text: description })
    ])
  ]);
}

function stat(label, value) {
  return node("article", { className: "stat" }, [node("span", { text: label }), node("strong", { text: value })]);
}

function badge(text, variant = "") {
  return node("span", { className: `badge ${variant}`.trim(), text });
}

function routeLink(label, path, className = "button") {
  return node("a", { href: path, "data-route": path, className, text: label });
}

function sectionTitle(title, linkLabel, path) {
  return node("div", { className: "section-title" }, [
    node("h2", { text: title }),
    path ? routeLink(linkLabel, path, "text-button") : null
  ]);
}

function modeCard([key, mode]) {
  const cost = state.dashboard.pricing?.aiChatStarCost || 1;
  return node("article", { className: "card", "data-mode": key }, [
    node("h3", { text: mode.label }),
    node("p", { text: `${mode.description} ${mode.billable ? `${cost} credit${cost === 1 ? "" : "s"} per successful prompt.` : "No AI credit charge."}` }),
    node("div", { className: "card-footer" }, [badge(mode.enabled ? "ONLINE" : "DISABLED", mode.enabled ? "" : "off"), node("code", { text: key })])
  ]);
}

function quickAction(label, description, path, status = "OPEN") {
  return node("article", { className: "card" }, [
    node("h3", { text: label }),
    node("p", { text: description }),
    node("div", { className: "card-footer" }, [routeLink("Launch", path, "button"), badge(status, status === "SETUP" ? "neutral" : "")])
  ]);
}

function renderHome() {
  const dashboard = state.dashboard;
  const role = dashboard.platformRole?.replaceAll("_", " ") || (dashboard.isAdmin ? "super admin" : "standard user");
  const credits = dashboard.unlimitedCredits ? "Unlimited" : String(dashboard.balance ?? "0");
  const modes = Object.entries(dashboard.modes || {});
  const children = [
    node("section", { className: "hero-card" }, [
      node("p", { className: "eyebrow", text: "SECURE TELEGRAM SESSION" }),
      node("h2", { text: "Your NVIDIA intelligence command center." }),
      node("p", { text: `Authenticated as Telegram user ${dashboard.userId}. Model controls, billing history, and AI operations stay bound to this verified session.` }),
      node("div", { className: "button-row" }, [routeLink("Start AI chat", "/chat", "button primary"), routeLink("View usage", "/usage", "button")])
    ]),
    node("section", { className: "stats" }, [stat("Platform role", role), stat("AI credits", credits), stat("Assistant mode", dashboard.selectedMode || "chat")]),
    node("section", { className: "section" }, [sectionTitle("Operational modes", "View all", "/settings"), node("div", { className: "grid" }, modes.slice(0, 6).map(modeCard))]),
    node("section", { className: "section" }, [sectionTitle("Quick actions"), node("div", { className: "grid" }, [
      quickAction("NVIDIA Models", "Choose from administrator-approved models.", "/models"),
      quickAction("Mode Studio", "Tune Nvid AI for coding, research, documents, translation, or executive work.", "/assistants"),
      quickAction("Payments", "Review your Telegram Stars payment ledger.", "/payments"),
      quickAction("Managed Groups", "Configure after live group permissions are detected.", "/groups", "SETUP"),
      ...(dashboard.platformAdmin ? [quickAction("Admin Console", "Platform health, models, features, billing, and logs.", "/admin")] : [])
    ])])
  ];
  app.replaceChildren(...children);
}

async function renderChat() {
  const [data, modeData] = await Promise.all([api("/api/models"), api("/api/modes")]);
  const output = node("div", { className: "chat-output", role: "log", "aria-live": "polite" });
  const message = node("textarea", { placeholder: "Ask Nvid AI anything…", maxlength: "8000" });
  const model = node("select");
  for (const item of data.models) model.append(node("option", { value: item.id, text: `${item.label} · ${item.tag}` }));
  model.value = data.defaultModel;
  const assistantMode = node("select");
  for (const item of modeData.modes.filter((item) => item.enabled)) {
    assistantMode.append(node("option", { value: item.id, text: item.label }));
  }
  assistantMode.value = modeData.selectedMode;
  assistantMode.addEventListener("change", async () => {
    assistantMode.disabled = true;
    try {
      await api("/api/modes/selection", { method: "POST", body: { mode: assistantMode.value } });
      state.dashboard.selectedMode = assistantMode.value;
      showToast(`${assistantMode.selectedOptions[0]?.text || assistantMode.value} activated`);
      haptic("medium");
    } catch (error) {
      assistantMode.value = modeData.selectedMode;
      showToast(error.message);
    } finally {
      assistantMode.disabled = false;
    }
  });
  const send = node("button", { className: "button primary", type: "button", text: "Generate" });
  const stop = node("button", { className: "button danger", type: "button", text: "Stop", disabled: "" });
  stop.disabled = true;

  async function generate() {
    const prompt = message.value.trim();
    if (!prompt || state.chatAbort) return;
    haptic("medium");
    output.textContent = "";
    send.disabled = true;
    stop.disabled = false;
    state.chatAbort = new AbortController();
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        signal: state.chatAbort.signal,
        headers: { "content-type": "application/json", authorization: `Bearer ${state.session}` },
        body: JSON.stringify({ requestId: requestId(), message: prompt, model: model.value })
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        throw new Error(detail.error || `AI request failed (${response.status})`);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const frames = buffer.split(/\r?\n\r?\n/);
        buffer = frames.pop() || "";
        for (const frame of frames) {
          const event = frame.match(/^event:\s*(.+)$/m)?.[1];
          const raw = frame.match(/^data:\s*(.+)$/m)?.[1];
          if (!raw) continue;
          const payload = JSON.parse(raw);
          if (event === "delta") output.textContent += payload.text || "";
          if (event === "meta" && payload.model) {
            model.value = payload.model;
            if (payload.mode) assistantMode.value = payload.mode;
          }
          if (event === "error") throw new Error(payload.error || "AI generation failed");
        }
        if (done) break;
        output.scrollTop = output.scrollHeight;
      }
      haptic("light");
    } catch (error) {
      if (error.name !== "AbortError") showToast(error.message);
    } finally {
      state.chatAbort = null;
      send.disabled = false;
      stop.disabled = true;
    }
  }
  send.addEventListener("click", generate);
  stop.addEventListener("click", () => state.chatAbort?.abort());
  app.replaceChildren(
    pageHead("AI Chat", "Stream a response from an approved NVIDIA model. A successful non-admin request uses the displayed AI credit price."),
    node("section", { className: "chat-console" }, [
      node("div", { className: "field" }, [node("label", { text: "Assistant mode" }), assistantMode]),
      node("div", { className: "field" }, [node("label", { text: "NVIDIA model" }), model]),
      output,
      node("div", { className: "field" }, [node("label", { text: "Message" }), message]),
      node("div", { className: "button-row" }, [send, stop])
    ])
  );
}

async function renderAssistantModes() {
  const data = await api("/api/modes");
  const cards = data.modes.map((mode) => {
    const active = mode.id === data.selectedMode;
    const action = node("button", {
      className: `button ${active ? "primary" : ""}`.trim(),
      type: "button",
      text: active ? "Active" : mode.enabled ? "Activate" : "Unavailable",
      disabled: mode.enabled ? null : ""
    });
    action.disabled = !mode.enabled || active;
    if (mode.enabled && !active) action.addEventListener("click", async () => {
      action.disabled = true;
      try {
        await api("/api/modes/selection", { method: "POST", body: { mode: mode.id } });
        state.dashboard.selectedMode = mode.id;
        haptic("medium");
        await renderAssistantModes();
      } catch (error) {
        showToast(error.message);
        action.disabled = false;
      }
    });
    return node("article", { className: `mode-profile ${active ? "active" : ""}`.trim() }, [
      node("div", { className: "mode-icon", text: mode.icon }),
      node("div", { className: "mode-copy" }, [
        node("div", { className: "mode-title" }, [node("h3", { text: mode.label }), badge(active ? "ACTIVE" : mode.enabled ? "READY" : "OFF", mode.enabled ? "" : "off")]),
        node("p", { text: mode.description }),
        node("small", { text: `AI Chat billing: ${data.aiChatStarCost} credit${data.aiChatStarCost === 1 ? "" : "s"} only after a successful answer.` })
      ]),
      action
    ]);
  });
  app.replaceChildren(
    pageHead("Mode Studio", "Switch the behavior layer used by the NVIDIA assistant. Modes change the system instructions; they do not grant unsupported Telegram access."),
    node("section", { className: "mode-stack" }, cards)
  );
}

async function renderModels() {
  const admin = state.dashboard.platformAdmin;
  const data = admin ? await api("/api/admin/models") : await api("/api/models");
  const models = data.models;
  const items = models.map((model) => {
    const enabled = model.enabled ?? true;
    const control = admin ? node("button", { className: `toggle ${enabled ? "on" : ""}`, type: "button", "aria-label": `${enabled ? "Disable" : "Enable"} ${model.label}` }) : badge(model.tag || "AVAILABLE", "neutral");
    if (admin) control.addEventListener("click", async () => {
      control.disabled = true;
      try {
        await api("/api/admin/models", { method: "POST", body: { requestId: requestId(), modelId: model.id, enabled: !enabled } });
        haptic();
        await renderModels();
      } catch (error) { showToast(error.message); control.disabled = false; }
    });
    return node("article", { className: "list-item" }, [
      node("div", {}, [node("h3", { text: model.label || model.id }), node("p", { text: model.description || "NVIDIA model" }), node("code", { text: model.id })]),
      node("div", {}, [control, admin && model.providerAvailable === false ? badge("PROVIDER OFFLINE", "danger") : null])
    ]);
  });
  app.replaceChildren(pageHead("NVIDIA Models", admin ? "Enable or disable models without editing source code. At least one model must remain enabled." : "Models approved by the Nvid AI administrator."), node("section", { className: "list" }, items));
}

function historyItem(title, subtitle, stateText, danger = false) {
  return node("article", { className: "list-item" }, [node("div", {}, [node("h3", { text: title }), node("p", { text: subtitle })]), badge(stateText, danger ? "danger" : "neutral")]);
}

async function renderBilling(kind) {
  const history = await api("/api/billing/history?limit=100");
  const isPayments = kind === "payments";
  const rows = isPayments ? history.payments : history.usage;
  const list = rows.map((row) => isPayments
    ? historyItem(`${row.amount} Telegram Star${row.amount === 1 ? "" : "s"}`, new Date(row.creditedAt).toLocaleString(), row.refundedAt ? "REFUNDED" : "CREDITED", Boolean(row.refundedAt))
    : historyItem(`${row.cost} AI credit${row.cost === 1 ? "" : "s"}`, new Date(row.createdAt).toLocaleString(), row.status.toUpperCase(), row.status === "restored"));
  app.replaceChildren(
    pageHead(isPayments ? "Payments" : "Usage", isPayments ? "Your auditable Telegram Stars payment history." : "Every reserved, completed, or restored AI credit deduction."),
    rows.length ? node("section", { className: "list" }, list) : node("section", { className: "empty-state" }, [node("h2", { text: "No records yet" }), node("p", { text: isPayments ? "Use /topup in Telegram when you need AI credits." : "Completed AI requests will appear here." })])
  );
}

async function renderAdmin(path) {
  if (!state.dashboard.platformAdmin) throw Object.assign(new Error("Administrator access is required"), { status: 403 });
  if (path === "/admin/models") return renderModels();
  if (path === "/admin/payments") {
    const data = await api("/api/admin/payments?limit=100");
    app.replaceChildren(pageHead("Payment Ledger", "Administrator view of Telegram Stars transactions."), node("section", { className: "list" }, data.payments.map((row) => historyItem(`${row.amount} XTR · User ${row.userId}`, new Date(row.creditedAt).toLocaleString(), row.refundedAt ? "REFUNDED" : "CREDITED", Boolean(row.refundedAt)))));
    return;
  }
  if (path === "/admin/logs") {
    const [audit, security] = await Promise.all([api("/api/admin/logs?limit=100"), api("/api/admin/security-events?limit=100")]);
    const rows = [
      ...audit.logs.map((row) => ({ title: row.action, text: `${row.result} · ${row.actor_user_id || "system"}`, time: row.created_at, danger: row.result !== "success" })),
      ...security.events.map((row) => ({ title: row.event_type, text: `${row.severity} security event`, time: row.created_at, danger: ["high", "critical"].includes(row.severity) }))
    ].sort((a, b) => new Date(b.time) - new Date(a.time));
    app.replaceChildren(pageHead("Audit & Security", "Secret-safe administrative and security events."), node("section", { className: "list" }, rows.map((row) => historyItem(row.title, `${row.text} · ${new Date(row.time).toLocaleString()}`, row.danger ? "REVIEW" : "LOGGED", row.danger))));
    return;
  }
  if (path === "/admin/features") {
    const data = await api("/api/admin/features");
    const items = data.features.map((feature) => {
      const toggle = node("button", { className: `toggle ${feature.enabled ? "on" : ""}`, type: "button", "aria-label": `Toggle ${feature.key}` });
      toggle.addEventListener("click", async () => {
        toggle.disabled = true;
        try {
          await api("/api/admin/features", { method: "POST", body: { requestId: requestId(), featureKey: feature.key, enabled: !feature.enabled } });
          await renderAdmin(path);
        } catch (error) { showToast(error.message); toggle.disabled = false; }
      });
      return node("article", { className: "list-item" }, [node("div", {}, [node("h3", { text: feature.key.replaceAll("_", " ") }), node("p", { text: feature.description })]), toggle]);
    });
    app.replaceChildren(pageHead("Feature Flags", "Direct routes and backend behavior use durable feature controls."), node("section", { className: "list" }, items));
    return;
  }
  if (path === "/admin/system") {
    const data = await api("/api/admin/system");
    const entries = [
      ["Deployment", data.configuration.deploymentVersion, true],
      ["Database", data.platform.ready ? "READY" : "UNAVAILABLE", data.platform.ready],
      ["Telegram webhook", data.telegram.webhookReady ? "READY" : "SETUP", data.telegram.webhookReady],
      ["NVIDIA provider", data.nvidia.status.toUpperCase(), data.nvidia.healthy],
      ["NVIDIA API key", data.configuration.nvidiaConfigured ? "CONFIGURED" : "MISSING", data.configuration.nvidiaConfigured]
    ];
    app.replaceChildren(pageHead("System Health", "Status only. Secret values are never returned to the Mini App."), node("section", { className: "list" }, entries.map(([title, value, ok]) => historyItem(title, String(value), ok ? "OK" : "ACTION", !ok))));
    return;
  }
  if (path === "/admin") {
    const data = await api("/api/admin/overview");
    app.replaceChildren(
      pageHead("Admin Console", "Authenticated platform control with every mutation audited."),
      node("section", { className: "stats" }, [stat("Platform users", data.overview.totalUsers), stat("AI requests", data.billing?.completedPrompts || "0"), stat("Stars purchased", data.billing?.totalStarsPurchased || "0")]),
      node("section", { className: "section" }, [sectionTitle("Operations"), node("div", { className: "grid" }, [
        quickAction("Models", "Provider catalog and model availability.", "/admin/models"),
        quickAction("Features", "Durable feature flags and rollouts.", "/admin/features"),
        quickAction("Payments", "Auditable Stars transaction history.", "/admin/payments"),
        quickAction("Logs", "Audit and security event streams.", "/admin/logs"),
        quickAction("System", "Deployment and provider health.", "/admin/system"),
        quickAction("Users", "Role controls remain gated during rollout.", "/admin/users", "SETUP")
      ])])
    );
    return;
  }
  if (path === "/admin/pricing") {
    const data = await api("/api/admin/pricing");
    const price = data.prices.find((item) => item.featureKey === "ai_chat");
    const input = node("input", { type: "number", min: "1", max: "10000", value: String(price?.starCost || 1) });
    const save = node("button", { className: "button primary", type: "button", text: "Save audited price" });
    save.addEventListener("click", async () => {
      const starCost = Number(input.value);
      save.disabled = true;
      try {
        await api("/api/admin/pricing", { method: "POST", body: { requestId: requestId(), featureKey: "ai_chat", starCost } });
        showToast("AI chat price updated");
        await authenticate();
      } catch (error) { showToast(error.message); } finally { save.disabled = false; }
    });
    app.replaceChildren(pageHead("AI Pricing", "The default remains 1 Star credit per successful message. Failed requests restore the full reservation."), node("section", { className: "card" }, [node("div", { className: "field" }, [node("label", { text: "Credits per successful AI chat message" }), input]), save]));
  }
}

function renderSettings() {
  const modes = Object.entries(state.dashboard.modes || {});
  app.replaceChildren(
    pageHead("Settings", "Telegram-aware personalization, modes, and account access."),
    node("section", { className: "card" }, [node("h3", { text: "Personal AI instructions" }), node("p", { text: state.dashboard.persona || "No custom persona is set." }), node("div", { className: "button-row" }, [node("button", { className: "button", type: "button", text: "Edit with /persona", onclick: openBot })])]),
    node("section", { className: "section" }, [sectionTitle("Mode availability"), node("div", { className: "grid" }, modes.map(modeCard))]),
    ...(state.dashboard.platformAdmin ? [node("section", { className: "section" }, [sectionTitle("Administrator"), node("div", { className: "button-row" }, [routeLink("Admin console", "/admin", "button primary"), routeLink("AI pricing", "/admin/pricing", "button")])])] : [])
  );
}

function renderHelp() {
  const commands = ["/dashboard", "/models", "/model", "/persona", "/reset", "/balance", "/topup", "/terms", "/paysupport", "/whoami"];
  app.replaceChildren(pageHead("Help", "Telegram commands remain available alongside this Mini App."), node("section", { className: "list" }, commands.map((command) => historyItem(command, "Run in your private chat with Nvid AI", "TELEGRAM"))), node("div", { className: "button-row" }, [node("button", { className: "button primary", type: "button", text: "Open Nvid AI bot", onclick: openBot })]));
}

function renderUnavailable(path) {
  const [title, description, requirement] = unavailableRoutes[path] || ["Unavailable", "This module is not available for the current context.", "Administrator rollout"];
  app.replaceChildren(pageHead(title, description), node("section", { className: "empty-state" }, [badge("SETUP REQUIRED", "neutral"), node("h2", { text: requirement }), node("p", { text: "Nvid AI will not claim or attempt Telegram actions until the required authorization is confirmed." }), node("div", { className: "button-row" }, [node("button", { className: "button", type: "button", text: "Open Telegram bot", onclick: openBot })])]));
}

function openBot() {
  haptic();
  if (state.botLink.startsWith("https://t.me/")) tg?.openTelegramLink?.(state.botLink);
  else window.location.assign(state.botLink);
}

async function render(path = currentPath()) {
  app.replaceChildren(node("section", { className: "loading-state" }, [node("span", { className: "loader" }), node("p", { text: "Loading secure workspace…" })]));
  updateNavigation(path);
  try {
    if (path === "/home") renderHome();
    else if (path === "/chat") await renderChat();
    else if (path === "/models") await renderModels();
    else if (path === "/assistants") await renderAssistantModes();
    else if (path === "/usage" || path === "/history" || path === "/payments") await renderBilling(path === "/payments" ? "payments" : "usage");
    else if (path === "/settings") renderSettings();
    else if (path === "/help") renderHelp();
    else if (path.startsWith("/admin") && !unavailableRoutes[path]) await renderAdmin(path);
    else renderUnavailable(path);
    app.focus({ preventScroll: true });
  } catch (error) {
    app.replaceChildren(node("section", { className: "error-state" }, [badge(error.status === 403 ? "ACCESS DENIED" : "CONNECTION ERROR", "danger"), node("h2", { text: error.message }), node("button", { className: "button", type: "button", text: "Retry", onclick: () => render(path) })]));
  }
}

function currentPath() {
  return ["/", "/miniapp.html"].includes(location.pathname) ? "/home" : location.pathname.replace(/\/$/, "") || "/home";
}

function navigate(path, { replace = false } = {}) {
  if (path === currentPath() && !replace) return;
  history[replace ? "replaceState" : "pushState"]({}, "", path);
  haptic();
  render(path);
}

function updateNavigation(path) {
  document.querySelectorAll("[data-route]").forEach((link) => link.classList.toggle("active", link.getAttribute("data-route") === path));
  const root = path === "/home";
  backButton.hidden = root;
  if (tg?.isVersionAtLeast?.("6.1")) {
    if (root) tg.BackButton?.hide?.(); else tg.BackButton?.show?.();
  }
}

function setupTelegram() {
  tg?.ready();
  tg?.expand();
  if (tg?.isVersionAtLeast?.("6.2")) tg.enableClosingConfirmation?.();
  const applyTheme = () => { document.body.dataset.theme = tg?.colorScheme === "light" ? "light" : "dark"; };
  applyTheme();
  tg?.onEvent?.("themeChanged", applyTheme);
  if (tg?.isVersionAtLeast?.("6.1")) tg.BackButton?.onClick?.(() => history.length > 1 ? history.back() : navigate("/home"));
  backButton.addEventListener("click", () => history.length > 1 ? history.back() : navigate("/home"));
}

function setupRouting() {
  document.addEventListener("click", (event) => {
    const link = event.target.closest("[data-route]");
    if (!link) return;
    event.preventDefault();
    navigate(link.getAttribute("data-route"));
  });
  window.addEventListener("popstate", () => render(currentPath()));
}

function setupConnectivity() {
  const update = () => {
    const offline = !navigator.onLine;
    offlineBanner.hidden = !offline;
    connectionState.classList.toggle("offline", offline);
    connectionState.lastChild.textContent = offline ? "OFFLINE" : "SECURE";
    if (!offline) render(currentPath());
  };
  window.addEventListener("online", update);
  window.addEventListener("offline", update);
  update();
}

function setupMatrixCanvas() {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const canvas = document.getElementById("matrix-canvas");
  const context = canvas.getContext("2d");
  let particles = [];
  const resize = () => {
    const ratio = Math.min(devicePixelRatio || 1, 2);
    canvas.width = innerWidth * ratio;
    canvas.height = innerHeight * ratio;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    particles = Array.from({ length: Math.min(70, Math.floor(innerWidth / 9)) }, (_, index) => ({ x: (index / 70) * innerWidth, y: Math.random() * innerHeight, speed: .25 + Math.random() * .8, glyph: Math.random() > .5 ? "1" : "0" }));
  };
  const draw = () => {
    context.clearRect(0, 0, innerWidth, innerHeight);
    context.font = "11px monospace";
    context.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#76ff36";
    for (const particle of particles) {
      context.globalAlpha = .12 + (particle.speed * .12);
      context.fillText(particle.glyph, particle.x, particle.y);
      particle.y += particle.speed;
      if (particle.y > innerHeight + 10) particle.y = -10;
    }
    requestAnimationFrame(draw);
  };
  addEventListener("resize", resize);
  resize();
  draw();
}

function startParamPath() {
  const value = tg?.initDataUnsafe?.start_param || new URLSearchParams(location.search).get("startapp") || "";
  const mapped = `/${value.replaceAll("_", "/")}`;
  return ["/chat", "/models", "/assistants", "/usage", "/payments", "/admin", "/admin/models", "/admin/features", "/admin/payments", "/admin/logs", "/admin/system"].includes(mapped) ? mapped : null;
}

async function start() {
  setupTelegram();
  setupRouting();
  setupConnectivity();
  setupMatrixCanvas();
  await authenticate();
  const launchPath = startParamPath();
  if (launchPath && currentPath() === "/home") navigate(launchPath, { replace: true });
  else await render(currentPath());
}

start().catch((error) => {
  app.replaceChildren(node("section", { className: "error-state" }, [badge("TELEGRAM AUTH REQUIRED", "danger"), node("h2", { text: "Open Nvid AI inside Telegram" }), node("p", { text: error.message }), node("button", { className: "button primary", type: "button", text: "Open bot", onclick: openBot })]));
});
