import { get, post, session } from "./api.js";
import { $, errorMessage, toggle } from "./dom.js";
import { onLangChange, t } from "./i18n.js";

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
    $("loginPinLabel").textContent = t(!status.exists ? "login.choosePin" : status.has_pin ? "login.pin" : "login.setPin");
    $("loginHint").textContent = !status.exists ? t("login.newHint") : status.has_pin ? "" : t("login.legacyHint");
    $("loginPin").autocomplete = status.exists ? "current-password" : "new-password";
    $("loginSubmit").textContent = t(status.exists ? "login.login" : "login.create");
  } else {
    $("loginSubmit").textContent = t("login.continue");
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
  onLangChange(render);

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
