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
  chatAbort: null,
  activeConversationId: sessionStorage.getItem("nvidbotActiveConversation") || ""
};

const unavailableRoutes = {
  "/threads": ["Threads", "Thread context is isolated by group, forum topic, and user. Add the bot to a forum group to activate topic controls.", "Forum topics and group access"],
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
      quickAction("Managed Groups", "Live moderation, Guard, rules, and permission status.", "/groups"),
      quickAction("Secretary", "Durable reminders delivered inside authorized Telegram chats.", "/secretary"),
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
  model.value = state.dashboard.preferredModel || data.defaultModel;
  if (state.activeConversationId) {
    try {
      const saved = await api(`/api/conversations/${state.activeConversationId}`);
      output.textContent = saved.messages
        .filter((item) => item.status === "completed")
        .map((item) => `${item.role === "user" ? "YOU" : "NVID AI"}\n${item.content}`)
        .join("\n\n");
    } catch (error) {
      if (error.status === 404) {
        state.activeConversationId = "";
        sessionStorage.removeItem("nvidbotActiveConversation");
      } else throw error;
    }
  }
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
        body: JSON.stringify({
          requestId: requestId(),
          message: prompt,
          model: model.value,
          conversationId: state.activeConversationId || undefined
        })
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
          if (event === "done" && payload.conversationId) {
            state.activeConversationId = payload.conversationId;
            sessionStorage.setItem("nvidbotActiveConversation", payload.conversationId);
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
  const newConversation = node("button", { className: "button", type: "button", text: "New conversation" });
  newConversation.addEventListener("click", () => {
    state.activeConversationId = "";
    sessionStorage.removeItem("nvidbotActiveConversation");
    output.textContent += `${output.textContent ? "\n\n" : ""}YOU\n${prompt}\n\nNVID AI\n`;
    message.value = "";
    showToast("New conversation ready");
  });
  app.replaceChildren(
    pageHead("AI Chat", "Stream a response from an approved NVIDIA model. A successful non-admin request uses the displayed AI credit price."),
    node("section", { className: "chat-console" }, [
      node("div", { className: "field" }, [node("label", { text: "Assistant mode" }), assistantMode]),
      node("div", { className: "field" }, [node("label", { text: "NVIDIA model" }), model]),
      output,
      node("div", { className: "field" }, [node("label", { text: "Message" }), message]),
      node("div", { className: "button-row" }, [send, stop, newConversation, routeLink("History", "/history", "button")])
    ])
  );
}

async function renderAssistantModes() {
  const [data, assistantsData] = await Promise.all([api("/api/modes"), api("/api/assistants")]);
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
  const name = node("input", { maxlength: "80", placeholder: "Assistant name" });
  const description = node("input", { maxlength: "500", placeholder: "Short description" });
  const instructions = node("textarea", { maxlength: "5000", placeholder: "System instructions" });
  const create = node("button", { className: "button primary", type: "button", text: "Create assistant" });
  create.addEventListener("click", async () => {
    if (!name.value.trim()) return showToast("Assistant name is required");
    create.disabled = true;
    try {
      await api("/api/assistants", {
        method: "POST",
        body: {
          name: name.value.trim(),
          description: description.value.trim(),
          systemInstructions: instructions.value.trim(),
          tone: "adaptive",
          language: state.dashboard.preferredLanguage || "auto",
          technicalLevel: "adaptive",
          responseLength: state.dashboard.responseLength || "balanced",
          memoryEnabled: state.dashboard.memoryEnabled !== false
        }
      });
      await renderAssistantModes();
    } catch (error) {
      showToast(error.message);
      create.disabled = false;
    }
  });
  const customAssistants = assistantsData.assistants.map((assistant) => {
    const remove = node("button", { className: "button danger", type: "button", text: "Delete" });
    remove.addEventListener("click", async () => {
      if (!window.confirm(`Delete ${assistant.name}?`)) return;
      await api(`/api/assistants/${assistant.id}`, { method: "DELETE" });
      await renderAssistantModes();
    });
    return node("article", { className: "list-item" }, [
      node("div", {}, [node("h3", { text: assistant.name }), node("p", { text: assistant.description || "Custom structured assistant" })]),
      node("div", {}, [badge(assistant.enabled ? "READY" : "OFF", assistant.enabled ? "" : "off"), remove])
    ]);
  });
  app.replaceChildren(
    pageHead("Mode Studio", "Switch the behavior layer used by the NVIDIA assistant. Modes change the system instructions; they do not grant unsupported Telegram access."),
    node("section", { className: "mode-stack" }, cards),
    node("section", { className: "section" }, [
      sectionTitle("Custom assistants"),
      customAssistants.length ? node("div", { className: "list" }, customAssistants) : node("p", { text: "No custom assistants yet." }),
      node("article", { className: "card" }, [
        node("div", { className: "field" }, [node("label", { text: "Name" }), name]),
        node("div", { className: "field" }, [node("label", { text: "Description" }), description]),
        node("div", { className: "field" }, [node("label", { text: "Validated system instructions" }), instructions]),
        create
      ])
    ])
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

async function renderConversations() {
  const data = await api("/api/conversations?limit=100");
  const search = node("input", { type: "search", placeholder: "Search conversations", maxlength: "160" });
  const list = node("section", { className: "list" });
  const draw = (items) => {
    list.replaceChildren(...items.map((conversation) => {
      const open = node("button", { className: "button primary", type: "button", text: "Open" });
      open.addEventListener("click", () => {
        state.activeConversationId = conversation.id;
        sessionStorage.setItem("nvidbotActiveConversation", conversation.id);
        navigate("/chat");
      });
      const rename = node("button", { className: "button", type: "button", text: "Rename" });
      rename.addEventListener("click", async () => {
        const title = window.prompt("Conversation title", conversation.title)?.trim();
        if (!title) return;
        await api(`/api/conversations/${conversation.id}`, { method: "PATCH", body: { title } });
        await renderConversations();
      });
      const remove = node("button", { className: "button danger", type: "button", text: "Delete" });
      remove.addEventListener("click", async () => {
        if (!window.confirm("Delete this conversation?")) return;
        await api(`/api/conversations/${conversation.id}`, { method: "DELETE" });
        if (state.activeConversationId === conversation.id) {
          state.activeConversationId = "";
          sessionStorage.removeItem("nvidbotActiveConversation");
        }
        await renderConversations();
      });
      return node("article", { className: "list-item" }, [
        node("div", {}, [
          node("h3", { text: conversation.title }),
          node("p", { text: `${conversation.channel.toUpperCase()} · ${new Date(conversation.updatedAt).toLocaleString()}` })
        ]),
        node("div", { className: "button-row" }, [open, rename, remove])
      ]);
    }));
    if (!items.length) list.replaceChildren(node("section", { className: "empty-state" }, [
      node("h2", { text: "No conversations yet" }),
      node("p", { text: "Start a new AI chat and it will appear here." }),
      routeLink("Start chat", "/chat", "button primary")
    ]));
  };
  draw(data.conversations);
  search.addEventListener("input", () => {
    const query = search.value.trim().toLocaleLowerCase();
    draw(data.conversations.filter((item) => item.title.toLocaleLowerCase().includes(query)));
  });
  app.replaceChildren(
    pageHead("Conversation History", "Durable AI conversations that survive restarts and deployments."),
    node("section", { className: "card" }, [search]),
    list
  );
}

async function renderGroups({ admin = false, purpose = "manage" } = {}) {
  const data = await api(admin ? "/api/admin/groups?limit=100" : "/api/groups?limit=100");
  const groups = data.groups || [];
  const items = groups.map((group) => {
    const status = group.botStatus === "administrator" || group.botStatus === "creator" ? "ADMIN" : "LIMITED";
    return node("article", { className: "list-item" }, [
      node("div", {}, [
        node("h3", { text: group.title }),
        node("p", { text: `${group.chatType} · ${group.chatId}${group.username ? ` · @${group.username}` : ""}` })
      ]),
      node("div", { className: "button-row" }, [badge(status, status === "ADMIN" ? "" : "neutral"), routeLink(purpose === "guard" ? "Guard" : "Manage", `/group/${group.chatId}`, "button")])
    ]);
  });
  app.replaceChildren(
    pageHead(admin ? "Group Administration" : purpose === "guard" ? "Guard Groups" : "Managed Groups", "Every action verifies the current Telegram administrator and bot permissions before execution."),
    groups.length ? node("section", { className: "list" }, items) : node("section", { className: "empty-state" }, [
      badge("SETUP REQUIRED", "neutral"),
      node("h2", { text: "No managed groups detected" }),
      node("p", { text: "Add Nvid AI to a Telegram group, promote it with only the permissions you need, then send a message in that group." }),
      node("button", { className: "button primary", type: "button", text: "Open Telegram bot", onclick: openBot })
    ])
  );
}

function booleanSetting(label, checked) {
  const input = node("input", { type: "checkbox" });
  input.checked = checked === true;
  return { input, element: node("label", { className: "setting-switch" }, [node("span", { text: label }), input]) };
}

async function renderGroup(chatId) {
  const data = await api(`/api/groups/${chatId}`);
  const group = data.group;
  const settings = data.settings;
  const moderation = booleanSetting("Moderation", settings.moderationEnabled);
  const guard = booleanSetting("Guard queue", settings.guardEnabled);
  const secretary = booleanSetting("Secretary", settings.secretaryEnabled);
  const welcome = booleanSetting("Welcome messages", settings.welcomeEnabled);
  const goodbye = booleanSetting("Goodbye messages", settings.goodbyeEnabled);
  const rules = node("textarea", { maxlength: "10000", placeholder: "Group rules" });
  rules.value = settings.rules || "";
  const welcomeMessage = node("textarea", { maxlength: "2000", placeholder: "Welcome {name} to the group." });
  welcomeMessage.value = settings.welcomeMessage || "";
  const save = node("button", { className: "button primary", type: "button", text: "Save group controls" });
  save.addEventListener("click", async () => {
    save.disabled = true;
    try {
      await api(`/api/groups/${chatId}/settings`, {
        method: "PATCH",
        body: {
          requestId: requestId(),
          changes: {
            moderationEnabled: moderation.input.checked,
            guardEnabled: guard.input.checked,
            secretaryEnabled: secretary.input.checked,
            welcomeEnabled: welcome.input.checked,
            goodbyeEnabled: goodbye.input.checked,
            welcomeMessage: welcomeMessage.value.trim() || null,
            rules: rules.value.trim() || null
          }
        }
      });
      showToast("Group controls saved");
      haptic("medium");
    } catch (error) { showToast(error.message); } finally { save.disabled = false; }
  });

  const action = node("select");
  for (const value of ["ban", "unban", "kick", "mute", "unmute", "warn", "unwarn", "approve", "reject", "lock", "unlock", "slowmode"]) {
    action.append(node("option", { value, text: value.toUpperCase() }));
  }
  const target = node("input", { inputmode: "numeric", placeholder: "Telegram target user ID" });
  const duration = node("input", { type: "number", min: "0", max: "31536000", placeholder: "Duration seconds (optional)" });
  const reason = node("textarea", { maxlength: "1000", placeholder: "Reason for the audited action" });
  const execute = node("button", { className: "button danger", type: "button", text: "Verify and execute" });
  execute.addEventListener("click", async () => {
    if (!["lock", "unlock", "slowmode"].includes(action.value) && !/^\d+$/.test(target.value.trim())) return showToast("Enter a valid target user ID");
    if (!window.confirm(`Execute ${action.value.toUpperCase()} after live Telegram permission verification?`)) return;
    execute.disabled = true;
    try {
      await api(`/api/groups/${chatId}/moderation`, {
        method: "POST",
        body: {
          requestId: requestId(),
          action: action.value,
          targetUserId: target.value.trim() || null,
          durationSeconds: duration.value === "" ? null : Number(duration.value),
          reason: reason.value.trim() || null
        }
      });
      showToast(`${action.value.toUpperCase()} completed`);
      await renderGroup(chatId);
    } catch (error) { showToast(error.message); } finally { execute.disabled = false; }
  });

  let guardPanel = node("section", { className: "empty-state compact" }, [node("p", { text: "Guard requests appear after the group enables Guard and Telegram sends join requests." })]);
  try {
    const queue = await api(`/api/groups/${chatId}/guard?limit=50`);
    if (queue.requests.length) guardPanel = node("section", { className: "list" }, queue.requests.map((entry) => {
      const controls = ["queued", "verification_pending"].includes(entry.status) ? ["approve", "reject"].map((decision) => node("button", {
        className: decision === "approve" ? "button primary" : "button danger",
        type: "button",
        text: decision,
        onclick: async () => {
          try {
            await api(`/api/groups/${chatId}/guard`, { method: "POST", body: { requestId: requestId(), action: decision, userId: entry.user_id, reason: "Mini App Guard decision" } });
            await renderGroup(chatId);
          } catch (error) { showToast(error.message); }
        }
      })) : [badge(entry.status.toUpperCase(), "neutral")];
      return node("article", { className: "list-item" }, [node("div", {}, [node("h3", { text: entry.user_snapshot?.firstName || `User ${entry.user_id}` }), node("p", { text: `${entry.status} · ${new Date(entry.requested_at).toLocaleString()}` })]), node("div", { className: "button-row" }, controls)]);
    }));
  } catch (error) {
    guardPanel = node("section", { className: "notice", text: `Guard setup: ${error.message}` });
  }

  app.replaceChildren(
    pageHead(group.title, "Live Telegram permissions are verified again for every moderation or Guard action."),
    node("section", { className: "stats" }, [stat("Bot status", group.botStatus), stat("Members", group.memberCount ?? "—"), stat("Guard queue", String(data.guardRequests?.filter((item) => ["queued", "verification_pending"].includes(item.status)).length || 0))]),
    node("section", { className: "card" }, [node("h3", { text: "Group configuration" }), moderation.element, guard.element, secretary.element, welcome.element, goodbye.element, node("div", { className: "field" }, [node("label", { text: "Welcome message" }), welcomeMessage]), node("div", { className: "field" }, [node("label", { text: "Rules" }), rules]), save]),
    node("section", { className: "section" }, [sectionTitle("Moderation console"), node("div", { className: "card" }, [node("div", { className: "field" }, [node("label", { text: "Action" }), action]), node("div", { className: "field" }, [node("label", { text: "Target" }), target]), node("div", { className: "field" }, [node("label", { text: "Duration" }), duration]), node("div", { className: "field" }, [node("label", { text: "Reason" }), reason]), execute])]),
    node("section", { className: "section" }, [sectionTitle("Guard queue"), guardPanel])
  );
}

async function renderSecretary() {
  const [data, jobData] = await Promise.all([api("/api/secretary/reminders?limit=100"), api("/api/secretary/jobs")]);
  const title = node("input", { maxlength: "200", placeholder: "Reminder title" });
  const message = node("textarea", { maxlength: "2000", placeholder: "What should Nvid AI remind you about?" });
  const due = node("input", { type: "datetime-local" });
  const create = node("button", { className: "button primary", type: "button", text: "Schedule reminder" });
  create.addEventListener("click", async () => {
    create.disabled = true;
    try {
      await api("/api/secretary/reminders", { method: "POST", body: { title: title.value, message: message.value, dueAt: new Date(due.value).toISOString() } });
      showToast("Reminder scheduled");
      await renderSecretary();
    } catch (error) { showToast(error.message); } finally { create.disabled = false; }
  });
  const reminders = data.reminders.map((item) => {
    const cancel = node("button", { className: "button danger", type: "button", text: "Cancel" });
    cancel.disabled = !["scheduled", "claimed"].includes(item.status);
    cancel.addEventListener("click", async () => {
      await api(`/api/secretary/reminders/${item.reminder_id}`, { method: "DELETE" });
      await renderSecretary();
    });
    return node("article", { className: "list-item" }, [node("div", {}, [node("h3", { text: item.title }), node("p", { text: `${new Date(item.due_at).toLocaleString()} · ${item.status}` })]), cancel]);
  });
  const digestTime = node("input", { type: "time", value: "08:00" });
  const scheduleDigest = node("button", { className: "button", type: "button", text: "Schedule daily digest" });
  scheduleDigest.addEventListener("click", async () => {
    scheduleDigest.disabled = true;
    try {
      await api("/api/secretary/jobs", { method: "POST", body: { jobType: "task_digest", schedule: `daily@${digestTime.value}`, timezone: "UTC" } });
      showToast("Daily task digest scheduled");
      await renderSecretary();
    } catch (error) { showToast(error.message); } finally { scheduleDigest.disabled = false; }
  });
  const jobs = jobData.jobs.map((job) => node("article", { className: "list-item" }, [
    node("div", {}, [node("h3", { text: "Daily task digest" }), node("p", { text: `${job.schedule} ${job.timezone} · next ${new Date(job.next_run_at).toLocaleString()}` })]),
    node("button", { className: "button danger", type: "button", text: "Pause", onclick: async () => { await api(`/api/secretary/jobs/${job.job_id}`, { method: "DELETE" }); await renderSecretary(); } })
  ]));
  app.replaceChildren(pageHead("Secretary", "Private and authorized-group reminders are delivered by a durable Telegram worker."), node("section", { className: "card" }, [node("div", { className: "field" }, [node("label", { text: "Title" }), title]), node("div", { className: "field" }, [node("label", { text: "Message" }), message]), node("div", { className: "field" }, [node("label", { text: "Due time" }), due]), create]), node("section", { className: "section" }, [sectionTitle("Daily automation"), node("div", { className: "card" }, [node("div", { className: "field" }, [node("label", { text: "UTC delivery time" }), digestTime]), scheduleDigest]), jobs.length ? node("div", { className: "list" }, jobs) : null]), node("section", { className: "section" }, [sectionTitle("Scheduled reminders"), reminders.length ? node("div", { className: "list" }, reminders) : node("p", { className: "notice", text: "No reminders scheduled." })]));
}

async function renderBots() {
  const data = await api("/api/bots");
  const name = node("input", { maxlength: "100", placeholder: "Managed bot name" });
  const token = node("input", { type: "password", autocomplete: "new-password", placeholder: "Telegram bot token" });
  const create = node("button", { className: "button primary", type: "button", text: "Encrypt and save" });
  create.disabled = !data.encryption.configured;
  create.addEventListener("click", async () => {
    create.disabled = true;
    try {
      await api("/api/bots", { method: "POST", body: { displayName: name.value, token: token.value } });
      token.value = "";
      showToast("Managed bot saved securely");
      await renderBots();
    } catch (error) { showToast(error.message); } finally { create.disabled = false; }
  });
  const bots = data.bots.map((bot) => {
    const test = node("button", { className: "button", type: "button", text: "Test" });
    test.disabled = !bot.hasCredential;
    test.addEventListener("click", async () => {
      try { await api(`/api/bots/${bot.id}/test`, { method: "POST" }); showToast("Telegram connection verified"); await renderBots(); } catch (error) { showToast(error.message); }
    });
    const remove = node("button", { className: "button danger", type: "button", text: "Delete" });
    remove.addEventListener("click", async () => {
      if (!window.confirm("Delete this managed bot profile and its encrypted credential?")) return;
      await api(`/api/bots/${bot.id}`, { method: "DELETE" });
      await renderBots();
    });
    return node("article", { className: "list-item" }, [node("div", {}, [node("h3", { text: bot.displayName }), node("p", { text: `${bot.status}${bot.telegramUsername ? ` · @${bot.telegramUsername}` : ""} · token never displayed` })]), node("div", { className: "button-row" }, [test, remove])]);
  });
  app.replaceChildren(...[
    pageHead("Managed Bots", "Credentials are encrypted with AES-256-GCM and are never returned to the browser."),
    !data.encryption.configured ? node("section", { className: "notice", text: "BOT_CREDENTIAL_ENCRYPTION_KEY is required before credentials can be saved." }) : null,
    node("section", { className: "card" }, [node("div", { className: "field" }, [node("label", { text: "Profile name" }), name]), node("div", { className: "field" }, [node("label", { text: "Bot token" }), token]), create]),
    node("section", { className: "section" }, [sectionTitle("Profiles"), bots.length ? node("div", { className: "list" }, bots) : node("p", { className: "notice", text: "No managed bot profiles." })])
  ].filter(Boolean));
}

async function renderAdminUsers() {
  const data = await api("/api/admin/users?limit=100");
  const search = node("input", { type: "search", placeholder: "Search by user ID, name, or username" });
  const list = node("section", { className: "list" });
  const draw = (users) => list.replaceChildren(...users.map((user) => {
    const manage = node("button", { className: "button", type: "button", text: "Manage" });
    manage.addEventListener("click", async () => {
      const detail = await api(`/api/admin/users/${user.userId}`);
      const note = window.prompt("Internal note (optional)", "") || undefined;
      const role = state.dashboard.platformRole === "super_admin" ? window.prompt("Platform role", detail.user.role)?.trim() : undefined;
      if (state.dashboard.platformRole === "super_admin" && !role) return;
      try {
        await api(`/api/admin/users/${user.userId}`, { method: "PATCH", body: { requestId: requestId(), role, note } });
        showToast("User access updated and audited");
        await renderAdminUsers();
      } catch (error) { showToast(error.message); }
    });
    const privileged = [];
    if (state.dashboard.platformRole === "super_admin") {
      const credits = node("button", { className: "button", type: "button", text: "Credits" });
      credits.addEventListener("click", async () => {
        const delta = Number(window.prompt("Credit adjustment (negative or positive whole number)", "0"));
        if (!Number.isSafeInteger(delta) || delta === 0) return;
        try { await api(`/api/admin/users/${user.userId}`, { method: "PATCH", body: { requestId: requestId(), creditDelta: delta, note: `Manual credit adjustment: ${delta}` } }); await renderAdminUsers(); } catch (error) { showToast(error.message); }
      });
      const unlimited = node("button", { className: "button", type: "button", text: user.unlimitedCredits ? "Meter usage" : "Unlimited" });
      unlimited.addEventListener("click", async () => {
        try { await api(`/api/admin/users/${user.userId}`, { method: "PATCH", body: { requestId: requestId(), unlimitedCredits: !user.unlimitedCredits } }); await renderAdminUsers(); } catch (error) { showToast(error.message); }
      });
      privileged.push(credits, unlimited);
    }
    const ban = node("button", { className: user.banned ? "button" : "button danger", type: "button", text: user.banned ? "Unban" : "Ban" });
    ban.addEventListener("click", async () => {
      try {
        await api(`/api/admin/users/${user.userId}`, { method: "PATCH", body: { requestId: requestId(), banned: !user.banned, banReason: user.banned ? null : "Banned from the Nvid AI admin console" } });
        await renderAdminUsers();
      } catch (error) { showToast(error.message); }
    });
    return node("article", { className: "list-item" }, [node("div", {}, [node("h3", { text: `${user.firstName || "Telegram user"} ${user.lastName || ""}`.trim() }), node("p", { text: `${user.userId} · ${user.role.replaceAll("_", " ")} · ${user.balance} credits${user.username ? ` · @${user.username}` : ""}` })]), node("div", { className: "button-row" }, [badge(user.banned ? "BANNED" : user.unlimitedCredits ? "UNLIMITED" : "ACTIVE", user.banned ? "danger" : ""), manage, ...privileged, ban])]);
  }));
  draw(data.users);
  search.addEventListener("input", () => {
    const query = search.value.toLowerCase();
    draw(data.users.filter((user) => JSON.stringify(user).toLowerCase().includes(query)));
  });
  app.replaceChildren(pageHead("User Management", "Roles, bans, unlimited access, credits, and internal notes are enforced server-side and audited."), node("section", { className: "card" }, [search]), list);
}

async function renderAdmin(path) {
  if (!state.dashboard.platformAdmin) throw Object.assign(new Error("Administrator access is required"), { status: 403 });
  if (path === "/admin/models") return renderModels();
  if (path === "/admin/users") return renderAdminUsers();
  if (path === "/admin/groups") return renderGroups({ admin: true });
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
      node("section", { className: "stats" }, [stat("Platform users", data.overview.totalUsers), stat("Active groups", data.overview.activeGroups || "0"), stat("AI requests", data.billing?.completedPrompts || "0"), stat("Stars purchased", data.billing?.totalStarsPurchased || "0"), stat("Guard queue", data.overview.pendingGuardRequests || "0"), stat("Reminders", data.overview.scheduledReminders || "0")]),
      node("section", { className: "section" }, [sectionTitle("Operations"), node("div", { className: "grid" }, [
        quickAction("Models", "Provider catalog and model availability.", "/admin/models"),
        quickAction("Features", "Durable feature flags and rollouts.", "/admin/features"),
        quickAction("Payments", "Auditable Stars transaction history.", "/admin/payments"),
        quickAction("Logs", "Audit and security event streams.", "/admin/logs"),
        quickAction("System", "Deployment and provider health.", "/admin/system"),
        quickAction("Users", "Roles, bans, credits, and notes.", "/admin/users"),
        quickAction("Groups", "Live permissions, Guard, and moderation controls.", "/admin/groups")
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

async function renderSettings() {
  const modes = Object.entries(state.dashboard.modes || {});
  const current = (await api("/api/user/settings")).settings;
  const language = node("input", { value: current.preferredLanguage || "auto", maxlength: "32" });
  const responseLength = node("select");
  for (const value of ["concise", "balanced", "detailed"]) responseLength.append(node("option", { value, text: value }));
  responseLength.value = current.responseLength || "balanced";
  const creativity = node("input", { type: "number", min: "0", max: "2", step: "0.1", value: String(current.creativity ?? 0.4) });
  const memoryEnabled = node("input", { type: "checkbox" });
  memoryEnabled.checked = current.memoryEnabled !== false;
  const instructions = node("textarea", { maxlength: "2000", placeholder: "Custom instructions for your assistant" });
  instructions.value = current.customInstructions || current.persona || "";
  const save = node("button", { className: "button primary", type: "button", text: "Save AI settings" });
  save.addEventListener("click", async () => {
    save.disabled = true;
    try {
      const result = await api("/api/user/settings", {
        method: "POST",
        body: {
          preferredLanguage: language.value.trim() || "auto",
          responseLength: responseLength.value,
          creativity: Number(creativity.value),
          memoryEnabled: memoryEnabled.checked,
          customInstructions: instructions.value.trim() || null
        }
      });
      Object.assign(state.dashboard, result.settings);
      showToast("AI settings saved");
    } catch (error) {
      showToast(error.message);
    } finally {
      save.disabled = false;
    }
  });
  app.replaceChildren(
    pageHead("Settings", "Telegram-aware personalization, modes, and account access."),
    node("section", { className: "card" }, [
      node("h3", { text: "Personal AI settings" }),
      node("div", { className: "field" }, [node("label", { text: "Preferred language" }), language]),
      node("div", { className: "field" }, [node("label", { text: "Response length" }), responseLength]),
      node("div", { className: "field" }, [node("label", { text: "Creativity (0-2)" }), creativity]),
      node("div", { className: "field" }, [node("label", { text: "Memory enabled" }), memoryEnabled]),
      node("div", { className: "field" }, [node("label", { text: "Custom instructions" }), instructions]),
      node("div", { className: "button-row" }, [save, node("button", { className: "button", type: "button", text: "Legacy /persona", onclick: openBot })])
    ]),
    node("section", { className: "section" }, [sectionTitle("Mode availability"), node("div", { className: "grid" }, modes.map(modeCard))]),
    ...(state.dashboard.platformAdmin ? [node("section", { className: "section" }, [sectionTitle("Administrator"), node("div", { className: "button-row" }, [routeLink("Admin console", "/admin", "button primary"), routeLink("AI pricing", "/admin/pricing", "button")])])] : [])
  );
}

function renderHelp() {
  const commands = ["/dashboard", "/models", "/model", "/persona", "/reset", "/balance", "/topup", "/terms", "/ban", "/mute", "/warn", "/purge", "/rules", "/modlog", "/paysupport", "/whoami"];
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
    else if (path === "/history") await renderConversations();
    else if (path === "/groups" || path === "/moderation") await renderGroups();
    else if (path === "/guard") await renderGroups({ purpose: "guard" });
    else if (/^\/group\/-?\d+$/.test(path)) await renderGroup(path.split("/").at(-1));
    else if (path === "/secretary") await renderSecretary();
    else if (path === "/bots") await renderBots();
    else if (path === "/usage" || path === "/payments") await renderBilling(path === "/payments" ? "payments" : "usage");
    else if (path === "/settings") await renderSettings();
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
  return ["/chat", "/models", "/assistants", "/groups", "/guard", "/secretary", "/bots", "/usage", "/payments", "/admin", "/admin/users", "/admin/groups", "/admin/models", "/admin/features", "/admin/payments", "/admin/logs", "/admin/system"].includes(mapped) ? mapped : null;
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
