const form = document.getElementById("balanceForm");
const cardIdInput = document.getElementById("cardId");
const accessCodeInput = document.getElementById("accessCode");
const button = document.getElementById("checkButton");
const result = document.getElementById("result");

cardIdInput.addEventListener("input", () => {
  const clean = cardIdInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^DEMO/, "").slice(0, 12);
  const groups = clean.match(/.{1,4}/g)?.join("-") || "";
  cardIdInput.value = groups ? `DEMO-${groups}` : cardIdInput.value.toUpperCase().startsWith("D") ? "DEMO-" : "";
});
accessCodeInput.addEventListener("input", () => { accessCodeInput.value = accessCodeInput.value.replace(/\D/g, "").slice(0, 6); });

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  result.replaceChildren();
  button.disabled = true;
  button.innerHTML = '<span class="spinner"></span> Checking securely…';
  try {
    const response = await fetch("/api/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cardId: cardIdInput.value, accessCode: accessCodeInput.value }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Unable to verify this card.");
    showBalance(payload.card);
  } catch (error) {
    showError(error instanceof Error ? error.message : "Unable to verify this card.");
  } finally {
    button.disabled = false;
    button.innerHTML = "View demo balance <span>→</span>";
  }
});

function showBalance(card) {
  const amount = new Intl.NumberFormat("en-KE", { style: "currency", currency: card.currency }).format(card.balanceMinor / 100);
  result.innerHTML = `<div class="balance-result"><div class="result-meta"><span>Available demo balance</span><b class="status-dot ${escapeText(card.status)}">${escapeText(card.status)}</b></div><div class="balance-amount">${escapeText(amount)}</div><div class="result-footer"><span>${escapeText(card.label)}</span><span>Updated ${escapeText(new Date(card.updatedAt).toLocaleString("en-KE"))}</span></div>${card.status !== "active" ? `<p class="status-warning">This demo card is currently ${escapeText(card.status)}. Contact the administrator.</p>` : ""}</div>`;
  document.getElementById("visualNumber").textContent = card.publicId;
  document.getElementById("visualLabel").textContent = card.label;
  document.getElementById("visualStatus").textContent = card.status.toUpperCase();
  document.getElementById("visualCard").classList.toggle("is-frozen", card.status !== "active");
}
function showError(message) { result.innerHTML = `<div class="error-box"><strong>We couldn’t verify this card</strong><span>${escapeText(message)}</span></div>`; }
function escapeText(value) { const span = document.createElement("span"); span.textContent = String(value); return span.innerHTML; }
