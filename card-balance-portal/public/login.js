const form = document.getElementById("loginForm");
const button = document.getElementById("loginButton");
const errorBox = document.getElementById("loginError");
form.addEventListener("submit", async (event) => {
  event.preventDefault(); errorBox.textContent = ""; button.disabled = true; button.textContent = "Signing in…";
  try {
    const response = await fetch("/api/admin/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: document.getElementById("password").value }) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Sign-in failed.");
    location.replace("/admin");
  } catch (error) { errorBox.textContent = error instanceof Error ? error.message : "Sign-in failed."; }
  finally { button.disabled = false; button.innerHTML = "Sign in <span>→</span>"; }
});
