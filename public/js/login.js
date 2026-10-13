import { get, post, session } from "./api.js";
import { $, errorMessage, toggle } from "./dom.js";

const NAME_RE = /^[A-Z0-9_-]{4,16}$/;

let status = null; // { name, exists, has_pin }
let checkSeq = 0;
let debounce = 0;

function setError(msg) {
  $("loginError").textContent = msg || "";
}

function render() {
  const name = $("loginName").value.trim();
  const ready = status && status.name === name;
  toggle($("loginPinRow"), !!ready);
  if (ready) {
    $("loginPinLabel").textContent = !status.exists ? "Choose a PIN" : status.has_pin ? "PIN" : "Set a PIN";
    $("loginHint").textContent = !status.exists
      ? "New game set. Share the name and PIN with whoever hosts your games."
      : status.has_pin
        ? ""
        : "This game set has no PIN yet — the one you enter now will protect it.";
    $("loginPin").autocomplete = status.exists ? "current-password" : "new-password";
    $("loginSubmit").textContent = status.exists ? "Log in" : "Create game set";
  }
  $("loginSubmit").disabled = !ready || $("loginPin").value.length < 4;
}

async function checkName() {
  const input = $("loginName");
  const up = input.value.toUpperCase().replace(/\s+/g, "");
  if (up !== input.value) input.value = up;
  setError("");
  status = null;
  render();
  if (!NAME_RE.test(up)) return;

  const seq = ++checkSeq;
  try {
    const r = await get(`/api/game-sets/${encodeURIComponent(up)}`);
    if (seq !== checkSeq) return;
    status = r;
    render();
    $("loginPin").focus();
  } catch (e) {
    if (seq === checkSeq) setError(errorMessage(e));
  }
}

export function initLogin({ onLoggedIn }) {
  $("loginName").addEventListener("input", () => {
    clearTimeout(debounce);
    status = null;
    render();
    debounce = setTimeout(checkName, 250);
  });
  $("loginPin").addEventListener("input", render);

  $("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if ($("loginSubmit").disabled || !status) return;
    $("loginSubmit").disabled = true;
    setError("");
    try {
      const r = await post("/api/auth/login", { name: status.name, pin: $("loginPin").value, create: !status.exists });
      session.set(r.token, r.game_set);
      $("loginPin").value = "";
      await onLoggedIn();
    } catch (err) {
      setError(errorMessage(err));
      $("loginPin").select();
    } finally {
      render();
    }
  });
}

export function showLogin(prefill = "") {
  status = null;
  $("loginName").value = prefill || "";
  $("loginPin").value = "";
  setError("");
  render();
  if ($("loginName").value) checkName();
  else $("loginName").focus();
}
