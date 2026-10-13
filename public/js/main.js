import { get, post, session, setUnauthorizedHandler } from "./api.js";
import { $, alertError, busy, h, initDialog, showDialog, showScreen, toggle } from "./dom.js";
import { initEditor, showEditor } from "./editor.js";
import { initGame, showGame } from "./game.js";
import { initLogin, showLogin } from "./login.js";
import { initSetup, showSetup } from "./setup.js";

let resumable = null;

function renderHeaderMeta() {
  $("headerMeta").replaceChildren(session.gameSet ? h("span", { class: "chip" }, session.gameSet) : "");
}

function goLogin() {
  const lastName = session.gameSet;
  session.clear();
  resumable = null;
  renderHeaderMeta();
  showScreen("screenLogin");
  showLogin(lastName);
}

async function goMenu() {
  renderHeaderMeta();
  showScreen("screenMenu");
  toggle($("menuResume"), false);
  $("menuResumeHint").textContent = "";
  try {
    const { match } = await get("/api/matches/current");
    resumable = match;
    toggle($("menuResume"), !!match);
    if (match) {
      $("menuResumeHint").textContent = `${match.team1} ${match.score1} : ${match.score2} ${match.team2} · round ${match.round_index + 1} of ${match.total_rounds}`;
    }
  } catch {
    resumable = null;
  }
}

async function changePin() {
  const current = h("input", { class: "input", type: "password", placeholder: "Current PIN", autocomplete: "current-password" });
  const next = h("input", { class: "input", type: "password", placeholder: "New PIN (min 4)", autocomplete: "new-password" });
  const ok = await showDialog({
    title: `Change PIN for ${session.gameSet}`,
    body: h("div", { class: "form" }, current, next, h("div", { class: "hint" }, "Other devices will be logged out.")),
    actions: [
      { label: "Cancel", value: false, variant: "secondary" },
      { label: "Change", value: true },
    ],
  });
  if (!ok) return;
  try {
    const r = await post("/api/auth/pin", { current_pin: current.value, new_pin: next.value });
    session.set(r.token, session.gameSet);
    await showDialog({ title: "PIN changed", text: "Use the new PIN next time you log in." });
  } catch (e) {
    await alertError(e);
  }
}

function wireMenu() {
  $("menuNewGame").addEventListener("click", () => {
    showScreen("screenSetup");
    showSetup();
  });
  $("menuResume").addEventListener("click", () => {
    if (!resumable) return;
    showScreen("screenGame");
    showGame(resumable);
  });
  $("menuEditor").addEventListener("click", () => {
    showScreen("screenEditor");
    showEditor();
  });
  $("menuPin").addEventListener("click", changePin);
  $("menuLogout").addEventListener(
    "click",
    busy($("menuLogout"), async () => {
      await post("/api/auth/logout").catch(() => {});
      goLogin();
    }),
  );
}

function boot() {
  initDialog();
  setUnauthorizedHandler(() => {
    goLogin();
    alertError("Your session has expired. Please log in again.", "Logged out");
  });
  initLogin({ onLoggedIn: goMenu });
  wireMenu();
  initSetup({
    onBack: goMenu,
    onMatchStarted: (match) => {
      showScreen("screenGame");
      showGame(match);
    },
  });
  initGame({ onMenu: goMenu });
  initEditor({ onBack: goMenu });

  if (session.token) goMenu();
  else {
    showScreen("screenLogin");
    showLogin(session.gameSet);
  }
}

boot();
