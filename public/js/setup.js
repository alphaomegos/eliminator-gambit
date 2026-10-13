import { get, post, session } from "./api.js";
import { $, errorMessage, h } from "./dom.js";
import { onLangChange, t } from "./i18n.js";

const MAX_ROUNDS = 10;
let sources = []; // [{ id, name, meta }]
let plan = [];
let onStarted = () => {};

const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* ignore */
    }
  },
};
const planKey = () => `eg.plan.${session.gameSet}`;

function renderPickList() {
  const box = $("roundPickList");
  if (!sources.length) {
    box.replaceChildren(h("div", { class: "hint" }, t("setup.noRounds")));
    return;
  }
  box.replaceChildren(
    ...sources.map((src) => {
      const idx = plan.indexOf(src.id);
      const picked = idx >= 0;
      return h(
        "label",
        { class: `roundPickRow${picked ? " picked" : ""}` },
        h("input", {
          type: "checkbox",
          checked: picked,
          onchange: (e) => {
            if (e.target.checked) {
              if (plan.length >= MAX_ROUNDS) {
                e.target.checked = false;
                $("setupError").textContent = t("setup.max", { n: MAX_ROUNDS });
                return;
              }
              plan.push(src.id);
            } else {
              plan = plan.filter((x) => x !== src.id);
            }
            $("setupError").textContent = "";
            store.set(planKey(), plan);
            renderPickList();
          },
        }),
        h("span", { class: "roundPickName" }, sourceName(src), h("span", { class: "mutedSmall" }, ` · ${t(`kind.${src.kind}`)} · ${t("items.count", { n: src.count })}`)),
        h("span", { class: `roundPickOrder${picked ? " active" : ""}` }, picked ? String(idx + 1) : ""),
      );
    }),
  );
}

/** Built-in sources get a localized name; user rounds keep theirs. */
const sourceName = (src) => (src.id.startsWith("builtin:") ? t(`${src.id}.name`) : src.name);

export function initSetup({ onBack, onMatchStarted }) {
  onLangChange(() => sources.length && renderPickList());
  onStarted = onMatchStarted;
  $("setupBack").addEventListener("click", onBack);
  $("setupClear").addEventListener("click", () => {
    plan = [];
    store.set(planKey(), plan);
    renderPickList();
  });
  $("setupForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("setupStart");
    $("setupError").textContent = "";
    if (!plan.length) {
      $("setupError").textContent = t("setup.pickOne");
      return;
    }
    const team1 = $("team1Input").value.trim() || t("setup.team1Default");
    const team2 = $("team2Input").value.trim() || t("setup.team2Default");
    store.set("eg.teams", [team1, team2]);
    store.set("eg.timer", Number($("timerSelect").value) || 0);
    btn.disabled = true;
    try {
      const match = await post("/api/matches", { team1, team2, plan });
      onStarted(match);
    } catch (err) {
      $("setupError").textContent = errorMessage(err);
    } finally {
      btn.disabled = false;
    }
  });
}

export async function showSetup() {
  const [t1, t2] = store.get("eg.teams", ["", ""]);
  $("team1Input").value = t1;
  $("team2Input").value = t2;
  $("timerSelect").value = String(store.get("eg.timer", 0));
  $("setupError").textContent = "";
  $("roundPickList").replaceChildren(h("div", { class: "hint" }, t("setup.loading")));

  try {
    const [{ builtins }, { templates }] = await Promise.all([get("/api/builtins"), get("/api/templates")]);
    sources = [
      ...templates.map((tpl) => ({ id: `template:${tpl.id}`, name: tpl.name, kind: tpl.kind, count: tpl.item_count })),
      ...builtins.map((b) => ({ id: b.id, name: b.name, kind: "rated", count: 11 })),
    ];
  } catch (err) {
    sources = [];
    $("setupError").textContent = errorMessage(err);
  }
  const known = new Set(sources.map((s) => s.id));
  plan = store.get(planKey(), []).filter((id) => known.has(id));
  if (!plan.length && sources.length) plan = [sources[0].id];
  renderPickList();
}
