import { get, post, session, setUnauthorizedHandler } from "./api.js";
import { $, alertError, busy, h, initDialog, showDialog, showScreen, toggle } from "./dom.js";
import { initEditor, showEditor } from "./editor.js";
import { initGame, showGame } from "./game.js";
import { initLogin, showLogin } from "./login.js";
import { initSetup, showSetup } from "./setup.js";
import { applyStatic, lang, onLangChange, setLang, t } from "./i18n.js";

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
      renderResumeHint();
    }
  } catch {
    resumable = null;
  }
}

function renderResumeHint() {
  const m = resumable;
  $("menuResumeHint").textContent = m
    ? t("menu.resumeHint", { team1: m.team1, team2: m.team2, score1: m.score1, score2: m.score2, round: m.round_index + 1, total: m.total_rounds })
    : "";
}

async function changePin() {
  const current = h("input", { class: "input", type: "password", placeholder: t("pin.current"), autocomplete: "current-password" });
  const next = h("input", { class: "input", type: "password", placeholder: t("pin.new"), autocomplete: "new-password" });
  const ok = await showDialog({
    title: t("pin.title", { name: session.gameSet }),
    body: h("div", { class: "form" }, current, next, h("div", { class: "hint" }, t("pin.hint"))),
    actions: [
      { label: t("common.cancel"), value: false, variant: "secondary" },
      { label: t("pin.change"), value: true },
    ],
  });
  if (!ok) return;
  try {
    const r = await post("/api/auth/pin", { current_pin: current.value, new_pin: next.value });
    session.set(r.token, session.gameSet);
    await showDialog({ title: t("pin.doneTitle"), text: t("pin.done") });
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
  applyStatic();
  $("langSwitch").addEventListener("click", () => setLang(lang === "ru" ? "en" : "ru"));
  onLangChange(renderResumeHint);
  initDialog();
  setUnauthorizedHandler(() => {
    goLogin();
    alertError(t("login.expired"), t("login.expiredTitle"));
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
