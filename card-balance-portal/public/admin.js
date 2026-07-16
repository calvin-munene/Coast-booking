let cards = [];
const table = document.getElementById("cardsTable");
const errorBox = document.getElementById("adminError");

loadCards();
document.getElementById("refreshButton").addEventListener("click", loadCards);
document.getElementById("issueForm").addEventListener("submit", issueCard);
document.getElementById("logoutButton").addEventListener("click", async () => {
  await fetch("/api/admin/logout", { method: "POST" }); location.replace("/login");
});

async function loadCards() {
  clearError(); table.className = "loading-table"; table.textContent = "Loading card records…";
  try {
    const response = await fetch("/api/admin/cards", { cache: "no-store" });
    if (response.status === 401) return location.replace("/login");
    const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Unable to load cards.");
    cards = payload.cards || []; renderCards(); updateMetrics();
  } catch (error) { showError(error instanceof Error ? error.message : "Unable to load cards."); }
}

async function issueCard(event) {
  event.preventDefault(); clearError(); const form = new FormData(event.currentTarget);
  try {
    const response = await fetch("/api/admin/cards", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label: form.get("label"), balance: Number(form.get("balance")), expiresAt: form.get("expiresAt") || null }) });
    const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Unable to issue card.");
    showSecret(payload.card.publicId, payload.accessCode); event.currentTarget.reset(); await loadCards();
  } catch (error) { showError(error instanceof Error ? error.message : "Unable to issue card."); }
}

async function updateCard(id, changes) {
  clearError();
  try {
    const response = await fetch(`/api/admin/cards/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(changes) });
    const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Unable to update card."); await loadCards();
  } catch (error) { showError(error instanceof Error ? error.message : "Unable to update card."); }
}

function renderCards() {
  if (!cards.length) { table.className = "empty-state"; table.textContent = "No cards yet. Issue your first demo card."; return; }
  table.className = "card-table-wrap";
  table.innerHTML = `<table class="card-table"><thead><tr><th>Card</th><th>Balance</th><th>Status</th><th>Controls</th></tr></thead><tbody>${cards.map(card => `<tr><td><strong>${escapeText(card.label)}</strong><code>${escapeText(card.publicId)}</code></td><td><input class="table-balance" id="balance-${card.id}" aria-label="Balance for ${escapeText(card.label)}" type="number" min="0" max="10000000" step="0.01" value="${(card.balanceMinor / 100).toFixed(2)}"></td><td><span class="status-chip ${card.status}">${escapeText(card.status)}</span></td><td><div class="row-actions"><button data-save="${card.id}">Save</button><button data-status="${card.id}">${card.status === "active" ? "Freeze" : "Activate"}</button></div></td></tr>`).join("")}</tbody></table>`;
  table.querySelectorAll("[data-save]").forEach(button => button.addEventListener("click", () => updateCard(Number(button.dataset.save), { balance: Number(document.getElementById(`balance-${button.dataset.save}`).value), reason: "Administrator adjustment" })));
  table.querySelectorAll("[data-status]").forEach(button => button.addEventListener("click", () => { const card = cards.find(item => item.id === Number(button.dataset.status)); updateCard(card.id, { status: card.status === "active" ? "frozen" : "active" }); }));
}

function updateMetrics() {
  const active = cards.filter(card => card.status === "active").length;
  document.getElementById("totalFloat").textContent = new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES", maximumFractionDigits: 0 }).format(cards.reduce((sum, card) => sum + card.balanceMinor, 0) / 100);
  document.getElementById("activeCards").textContent = active; document.getElementById("frozenCards").textContent = `${cards.length - active} frozen`; document.getElementById("totalCards").textContent = cards.length;
}
function showSecret(cardId, accessCode) {
  const area = document.getElementById("secretBanner"); area.innerHTML = `<div class="secret-banner"><div><strong>Card issued successfully</strong><p>Copy this access code now. It cannot be viewed again.</p></div><code>${escapeText(cardId)}</code><code>${escapeText(accessCode)}</code><button id="copySecret">Copy details</button><button class="close-secret" id="closeSecret" aria-label="Dismiss">×</button></div>`;
  document.getElementById("copySecret").addEventListener("click", () => navigator.clipboard.writeText(`${cardId}\n${accessCode}`)); document.getElementById("closeSecret").addEventListener("click", () => area.replaceChildren());
}
function showError(message) { errorBox.hidden = false; errorBox.textContent = message; }
function clearError() { errorBox.hidden = true; errorBox.textContent = ""; }
function escapeText(value) { const span = document.createElement("span"); span.textContent = String(value); return span.innerHTML; }
