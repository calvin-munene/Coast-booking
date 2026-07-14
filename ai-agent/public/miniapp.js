const tg = window.Telegram?.WebApp;
let botLink = "/";
const setText = (id, value) => {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
};

function modeCard([key, mode]) {
  const node = document.createElement("article");
  node.className = "mode";
  node.innerHTML = `
    <div>
      <strong>${mode.label}</strong>
      <p>${mode.description} ${mode.billable ? "Costs 1 credit per accepted prompt." : "Free mode."}</p>
    </div>
    <span class="badge ${mode.enabled ? "" : "off"}">${mode.enabled ? "ON" : "OFF"}</span>
  `;
  node.dataset.mode = key;
  return node;
}

async function loadDashboard() {
  tg?.ready();
  tg?.expand();
  const response = await fetch("/api/miniapp/state", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ initData: tg?.initData || "" })
  });
  if (!response.ok) {
    setText("role", "Telegram only");
    setText("credits", "--");
    setText("access", "Open inside Telegram");
    document.getElementById("modes").innerHTML = '<p class="copy">Launch this dashboard from /dashboard inside Telegram.</p>';
    return;
  }
  const { dashboard } = await response.json();
  botLink = dashboard.telegram?.link || "/";
  setText("role", dashboard.isAdmin ? "Admin" : "User");
  setText("credits", dashboard.unlimitedCredits ? "Unlimited" : String(dashboard.balance ?? "0"));
  setText("access", dashboard.banned ? "Banned" : "Active");
  setText("persona", dashboard.persona || "No custom style set. Use /persona in Telegram to personalize the AI.");

  const modes = document.getElementById("modes");
  modes.replaceChildren(...Object.entries(dashboard.modes).map(modeCard));

  if (dashboard.isAdmin) {
    document.getElementById("admin-panel").classList.remove("hidden");
    setText("total-users", dashboard.stats?.totalUsers || "0");
    setText("total-balance", dashboard.stats?.totalBalance || "0");
    setText("paid-prompts", dashboard.stats?.completedPrompts || "0");
  }
}

document.getElementById("open-bot").addEventListener("click", () => {
  if (botLink.startsWith("https://t.me/")) tg?.openTelegramLink?.(botLink);
  else window.location.href = botLink;
});

document.getElementById("close-app").addEventListener("click", () => {
  tg?.close?.();
});

loadDashboard().catch(() => {
  setText("role", "Offline");
  setText("credits", "--");
  setText("access", "Retry later");
});
