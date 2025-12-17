let round = null;

let teamNames = {
  1: localStorage.getItem("team1") || "Team 1",
  2: localStorage.getItem("team2") || "Team 2",
};

let templatesCache = [];
let currentTemplateId = null;
let currentTemplateKind = "rated";

let templatesLoadedAt = 0;

/* Multi-round match state */
let gamePlanDraft = []; // what host selects on Teams screen (ordered)
let gamePlan = [];      // frozen plan for current match
let gameIndex = 0;      // current round index in gamePlan
let scores = { 1: 0, 2: 0 };

const el = (id) => document.getElementById(id);

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function showScreen(name) {
  const screens = ["screenMenu", "screenTeams", "screenGame", "screenEditor"];
  for (const s of screens) el(s)?.classList.toggle("hidden", s !== name);
  el("menuBtn")?.classList.toggle("hidden", name === "screenMenu");
}

function getTeamBox(team) {
  return el(team === 1 ? "team1Box" : "team2Box") || el(team === 1 ? "team1" : "team2");
}

function setActiveTeam(team) {
  const t1 = getTeamBox(1);
  const t2 = getTeamBox(2);
  t1?.classList.toggle("active", team === 1);
  t2?.classList.toggle("active", team === 2);
}

function updateTeamLabels() {
  if (el("team1")) el("team1").textContent = teamNames[1];
  if (el("team2")) el("team2").textContent = teamNames[2];
}

function renderScores() {
  if (el("score1")) el("score1").textContent = String(scores[1] ?? 0);
  if (el("score2")) el("score2").textContent = String(scores[2] ?? 0);
}

function setRoundStatus(text, kind = "") {
  const n = el("roundStatus");
  if (!n) return;

  n.textContent = text || "";
  n.classList.remove("win", "tie");

  if (kind === "win") n.classList.add("win");
  if (kind === "tie") n.classList.add("tie");
}

function openModal(title, text) {
  el("modalTitle").textContent = title;
  el("modalText").innerHTML = text;
  el("modal").classList.remove("hidden");
}

function closeModal() {
  el("modal").classList.add("hidden");
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });

  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const data = await res.json();
      if (data && data.detail) msg = data.detail;
    } catch (_) {}
    throw new Error(msg);
  }

  return res.json();
}

/* ---------- Templates loading ---------- */
async function loadTemplates({ force = false } = {}) {
  const now = Date.now();
  if (!force && templatesCache.length && (now - templatesLoadedAt) < 30000) return templatesCache;

  const data = await api("/api/templates");
  templatesCache = data.templates || [];
  templatesLoadedAt = now;
  return templatesCache;
}


/* ---------- Multi-round pick UI ---------- */
function loadGamePlanDraft() {
  try {
    const raw = localStorage.getItem("gamePlan");
    const parsed = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed) && parsed.length) return parsed;
  } catch (_) {}

  // Backward compatibility: if older single choice existed
  const old = localStorage.getItem("roundSet");
  if (old) return [old];

  return ["builtin:movies"];
}

function saveGamePlanDraft() {
  localStorage.setItem("gamePlan", JSON.stringify(gamePlanDraft));
}

function getOrderNumber(id) {
  const idx = gamePlanDraft.indexOf(id);
  return idx >= 0 ? (idx + 1) : null;
}

function renderRoundPickList() {
  const box = el("roundPickList");
  if (!box) return;

  box.innerHTML = "";

  const items = [];
  items.push({ id: "builtin:movies", name: "Built-in: Movies (random 11)" });
  for (const t of templatesCache) items.push({ id: `template:${t.id}`, name: t.name });

  for (const it of items) {
    const row = document.createElement("div");
    row.className = "roundPickRow";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = gamePlanDraft.includes(it.id);

    const name = document.createElement("div");
    name.className = "roundPickName";
    name.textContent = it.name;

    const ord = document.createElement("div");
    ord.className = "roundPickOrder";

    const n = getOrderNumber(it.id);
    if (n != null) {
      ord.classList.add("active");
      ord.textContent = String(n);
    } else {
      ord.textContent = "";
    }

    cb.addEventListener("change", () => {
      if (cb.checked) {
        if (!gamePlanDraft.includes(it.id)) gamePlanDraft.push(it.id);
      } else {
        gamePlanDraft = gamePlanDraft.filter((x) => x !== it.id);
      }

      // Enforce 1..10
      if (gamePlanDraft.length > 10) {
        gamePlanDraft = gamePlanDraft.slice(0, 10);
        cb.checked = false;
      }

      saveGamePlanDraft();
      renderRoundPickList();
    });

    row.appendChild(cb);
    row.appendChild(name);
    row.appendChild(ord);

    box.appendChild(row);
  }
}

/* ---------- Game runtime (multi-round) ---------- */
function hasNextRound() {
  return gameIndex < (gamePlan.length - 1);
}

function getCurrentRoundSetId() {
  return gamePlan[gameIndex] || "builtin:movies";
}

async function createRoundFor(roundSetId) {
  if (roundSetId && roundSetId.startsWith("template:")) {
    const templateId = roundSetId.slice("template:".length);
    return api("/api/rounds/from-template", {
      method: "POST",
      body: JSON.stringify({ template_id: templateId }),
    });
  }

  // builtin
  return api("/api/rounds", {
    method: "POST",
    body: JSON.stringify({ category: "movies" }),
  });
}

function renderRoundImage() {
  const frame = el("roundImageFrame");
  const img = el("roundImage");
  if (!frame || !img) return;

  const data = round?.image_data;
  if (!data) {
    frame.classList.add("hidden");
    img.removeAttribute("src");
    return;
  }

  frame.classList.remove("hidden");
  img.src = detectDataUrl(data);
}

function renderGame() {
  if (!round) return;

  if (el("prompt")) el("prompt").textContent = round.prompt || "";
  updateTeamLabels();
  setActiveTeam(round.current_team);
  renderScores();
  renderRoundImage();

  const list = el("itemsList");
  if (!list) return;

  list.innerHTML = "";

  const isFinished = round.status !== "active";
  const isTie = isFinished && !round.winner_team && !round.loser_team;

  if (isFinished) {
    if (isTie) {
      setRoundStatus("This round is a tie.", "tie");
    } else {
      const winnerName = round.winner_team ? teamNames[round.winner_team] : "Winner";
      setRoundStatus(`${winnerName} wins this round.`, "win");
    }
  } else {
    setRoundStatus("", "");
  }

  for (const item of round.items) {
    const li = document.createElement("li");
    li.className = "item";

    const clickable = !isFinished && !item.eliminated;
    li.classList.add(clickable ? "clickable" : "notClickable");

    const isLosingPick = isFinished && item.is_target === true;
    if (isLosingPick) li.classList.add("losingPick");

    const left = document.createElement("div");

    const title = document.createElement("div");
    title.className = "itemTitle";
    title.textContent = item.title;

    const meta = document.createElement("div");
    meta.className = "itemMeta";

    if (item.rating != null) {
      meta.textContent = `Rating: ${item.rating}`;
    } else if (item.secret_text != null) {
      meta.textContent = String(item.secret_text);
    } else {
      meta.textContent = "";
    }

    if (item.eliminated) title.classList.add("eliminated");

    left.appendChild(title);
    left.appendChild(meta);

    const right = document.createElement("div");
    right.className = "itemRight";
    if (item.eliminated && item.eliminated_by_team) {
      right.textContent = teamNames[item.eliminated_by_team] || "";
    } else {
      right.textContent = "";
    }

    li.appendChild(left);
    li.appendChild(right);

    if (isLosingPick && hasNextRound()) {
      const overlay = document.createElement("div");
      overlay.className = "nextRoundOverlay";

      const btn = document.createElement("button");
      btn.className = "btn success";
      btn.type = "button";
      btn.textContent = "Next round";

      btn.addEventListener("click", async (evt) => {
        evt.stopPropagation();
        try {
          await goNextRound();
        } catch (e) {
          openModal("Error", escapeHtml(String(e.message || e)));
        }
      });

      overlay.appendChild(btn);
      li.appendChild(overlay);
    }

    li.addEventListener("click", async () => {
      if (!clickable) return;
      await eliminate(item.id);
    });

    list.appendChild(li);
  }
}

async function startRound() {
  closeModal();
  round = await createRoundFor(getCurrentRoundSetId());
  showScreen("screenGame");
  renderGame();
}

async function startMatch() {
  scores = { 1: 0, 2: 0 };
  gameIndex = 0;
  renderScores();
  await startRound();
}

async function goNextRound() {
  if (!hasNextRound()) return;
  gameIndex += 1;
  await startRound();
}

async function eliminate(itemId) {
  try {
    const actingTeam = round.current_team;

    round = await api(`/api/rounds/${round.id}/eliminate`, {
      method: "POST",
      body: JSON.stringify({ item_id: itemId }),
    });

    // Scoring:
    // +1 for any safe elimination
    // -4 if the eliminated item is the target (losing pick)
    const picked = round.items.find((x) => String(x.id) === String(itemId));
    const isFinished = round.status !== "active";
    const pickedWasTarget = !!(picked && isFinished && picked.is_target === true);

    if (pickedWasTarget) {
      scores[actingTeam] = (scores[actingTeam] || 0) - 4;
    } else {
      scores[actingTeam] = (scores[actingTeam] || 0) + 1;
    }

    renderGame();
  } catch (e) {
    openModal("Error", escapeHtml(String(e.message || e)));
  }
}

/* ---------- Templates editor (existing logic stays) ---------- */
function setEditorStatus(text) {
  const n = el("editorStatus");
  if (n) n.textContent = text || "";
}

function detectDataUrl(data) {
  const s = String(data || "").trim();
  if (!s) return "";
  if (s.startsWith("data:")) return s;

  // If DB stores raw base64 without prefix — try to guess mime a bit.
  let mime = "image/png";
  if (s.startsWith("/9j/")) mime = "image/jpeg";              // JPEG base64 header
  else if (s.startsWith("iVBORw0KGgo")) mime = "image/png";   // PNG base64 header
  else if (s.startsWith("R0lGOD")) mime = "image/gif";        // GIF base64 header
  else if (s.startsWith("UklGR")) mime = "image/webp";        // WEBP base64 header (rough)

  return `data:${mime};base64,${s}`;
}

function applyTemplateImage(data) {
  const hidden = el("tplImageData");
  const wrap = el("tplImagePreviewWrap");
  const img = el("tplImagePreview");
  const file = el("tplImage");

  if (hidden) hidden.value = data ? String(data) : "";
  if (file) file.value = ""; // prevent stale selected file after switching templates

  if (!wrap || !img) return;

  if (!data) {
    wrap.classList.add("hidden");
    img.removeAttribute("src");
    return;
  }

  wrap.classList.remove("hidden");
  img.src = detectDataUrl(data);
}

function setItemsHeaderHint(kind) {
  const editor = el("screenEditor");
  if (!editor) return;
  const hint = editor.querySelector(".itemsHeader .mutedSmall");
  if (!hint) return;
  hint.textContent = kind === "manual" ? "Title + hidden info + target" : "Title + rating";
}

function readTitlesOnlyFromForm() {
  const titles = new Array(11).fill("");
  const box = el("tplItems");
  if (!box) return titles.map((t) => ({ title: t }));

  const inputs = box.querySelectorAll('input[data-field="title"]');
  for (const inp of inputs) {
    const idx = Number(inp.dataset.idx);
    if (!Number.isNaN(idx) && idx >= 0 && idx <= 10) titles[idx] = inp.value ?? "";
  }
  return titles.map((t) => ({ title: t }));
}

function renderTemplatesList() {
  const box = el("templatesList");
  if (!box) return;

  box.innerHTML = "";

  for (const t of templatesCache) {
    const row = document.createElement("div");
    row.className = "tplRow";
    row.classList.toggle("active", currentTemplateId === t.id);

    const name = document.createElement("div");
    name.className = "tplRowName";
    name.textContent = t.name;

    const meta = document.createElement("div");
    meta.className = "tplRowMeta";
    const kind = t.kind ? ` • ${t.kind}` : "";
    meta.textContent = `${t.item_count} items${kind}`;

    row.appendChild(name);
    row.appendChild(meta);

    row.addEventListener("click", async () => {
      await selectTemplate(t.id);
    });

    box.appendChild(row);
  }
}

function ensureTemplateKindControl() {
  const kindSel = el("tplKind");
  if (!kindSel) return;

  if (kindSel.dataset.bound === "1") return;
  kindSel.dataset.bound = "1";

  kindSel.addEventListener("change", () => {
    currentTemplateKind = kindSel.value || "rated";
    const base = readTitlesOnlyFromForm();
    const seedItems =
      currentTemplateKind === "manual"
        ? base.map((x) => ({ title: x.title, secret_text: "", is_target: false }))
        : base.map((x) => ({ title: x.title, rating: "" }));

    renderTemplateItemsForm(seedItems, currentTemplateKind);
  });

  currentTemplateKind = kindSel.value || currentTemplateKind || "rated";
  setItemsHeaderHint(currentTemplateKind);
}

function getKindFromUI() {
  const k = el("tplKind");
  return (k && k.value) ? k.value : currentTemplateKind || "rated";
}

function normalizeItemsTo11(items, kind) {
  const rows = [];
  for (const it of items || []) {
    if (kind === "manual") {
      rows.push({
        title: it.title ?? "",
        secret_text: it.secret_text ?? "",
        is_target: !!it.is_target,
      });
    } else {
      rows.push({
        title: it.title ?? "",
        rating: it.rating ?? "",
      });
    }
  }
  while (rows.length < 11) {
    rows.push(kind === "manual" ? { title: "", secret_text: "", is_target: false } : { title: "", rating: "" });
  }
  return rows.slice(0, 11);
}

function renderTemplateItemsForm(items, kind) {
  ensureTemplateKindControl();
  setItemsHeaderHint(kind || "rated");

  const k = el("tplKind");
  if (k) k.value = kind || "rated";

  const box = el("tplItems");
  if (!box) return;

  box.innerHTML = "";
  const rows = normalizeItemsTo11(items, kind);

  rows.forEach((it, idx) => {
    const row = document.createElement("div");
    row.className = "tplItemRow";

    row.style.display = "grid";
    row.style.gap = "10px";
    row.style.gridTemplateColumns = (kind === "manual") ? "1fr 1fr 44px" : "1fr 140px";

    const title = document.createElement("input");
    title.className = "input";
    title.placeholder = `Item ${idx + 1} title`;
    title.value = it.title ?? "";
    title.dataset.idx = String(idx);
    title.dataset.field = "title";

    row.appendChild(title);

    if (kind === "manual") {
      const secret = document.createElement("input");
      secret.className = "input";
      secret.placeholder = "Hidden info";
      secret.value = it.secret_text ?? "";
      secret.dataset.idx = String(idx);
      secret.dataset.field = "secret_text";

      const target = document.createElement("input");
      target.type = "radio";
      target.name = "targetPick";
      target.checked = !!it.is_target;
      target.dataset.idx = String(idx);
      target.dataset.field = "is_target";
      target.title = "Target (losing) item";

      row.appendChild(secret);
      row.appendChild(target);
    } else {
      const rating = document.createElement("input");
      rating.className = "input";
      rating.placeholder = "Rating";
      rating.value = it.rating ?? "";
      rating.inputMode = "decimal";
      rating.dataset.idx = String(idx);
      rating.dataset.field = "rating";

      row.appendChild(rating);
    }

    box.appendChild(row);
  });
}

function readTemplateItemsFromForm(kind) {
  const container = el("tplItems");
  if (!container) return [];

  const rows = new Array(11).fill(0).map(() => ({
    title: "",
    rating: "",
    secret_text: "",
    is_target: false,
  }));

  const inputs = container.querySelectorAll("input,select,textarea");
  for (const inp of inputs) {
    const idx = Number(inp.dataset.idx);
    const field = inp.dataset.field;
    if (Number.isNaN(idx) || idx < 0 || idx > 10) continue;
    if (!field) continue;

    if (field === "is_target") rows[idx][field] = !!inp.checked;
    else rows[idx][field] = inp.value;
  }

  const items = [];
  for (const r of rows) {
    const title = String(r.title || "").trim();
    const hasAny =
      title ||
      String(r.rating || "").trim() ||
      String(r.secret_text || "").trim() ||
      !!r.is_target;

    if (!hasAny) continue;
    if (!title) throw new Error("Each item must have a title.");

    if (kind === "manual") {
      const secret = String(r.secret_text || "").trim();
      if (!secret) throw new Error("Manual round: each item must have hidden info.");
      items.push({ title, secret_text: secret, is_target: !!r.is_target });
    } else {
      const ratingRaw = String(r.rating || "").trim();
      const rating = Number(ratingRaw);
      if (!Number.isFinite(rating)) throw new Error("Rated round: each item must have a numeric rating.");
      items.push({ title, rating });
    }
  }

  return items;
}

async function selectTemplate(id) {
  setEditorStatus("");
  currentTemplateId = id;
  renderTemplatesList();

  ensureTemplateKindControl();

  const tpl = await api(`/api/templates/${id}`);
  el("tplName").value = tpl.name || "";
  el("tplPrompt").value = tpl.prompt || "";

  currentTemplateKind = tpl.kind || "rated";
  const k = el("tplKind");
  if (k) k.value = currentTemplateKind;

  renderTemplateItemsForm(tpl.items || [], currentTemplateKind);
  applyTemplateImage(tpl.image_data || "");
}

function clearEditorForm() {
  currentTemplateId = null;
  el("tplName").value = "";
  el("tplPrompt").value = "";

  ensureTemplateKindControl();
  currentTemplateKind = "rated";
  const k = el("tplKind");
  if (k) k.value = "rated";

  renderTemplateItemsForm([], "rated");
  renderTemplatesList();
  setEditorStatus("");
  applyTemplateImage("");
}

async function saveTemplate() {
  setEditorStatus("");
  ensureTemplateKindControl();

  const name = el("tplName").value.trim();
  const prompt = el("tplPrompt").value.trim();
  const kind = getKindFromUI();
  const items = readTemplateItemsFromForm(kind);

  if (!name) throw new Error("Round name is required.");
  if (!prompt) throw new Error("Prompt is required.");
  if (items.length < 2) throw new Error("Add at least 2 items.");

  if (kind === "manual") {
    const targets = items.filter((x) => x.is_target);
    if (targets.length !== 1) throw new Error("Manual round: select exactly 1 target item.");
  }

  // Keep image_data if your editor sends it (otherwise it will be ignored by backend)
  const imgEl = el("tplImageData");
  const image_data = imgEl ? (imgEl.value || null) : null;

  const body = { kind, name, prompt, items, image_data };

  if (!currentTemplateId) {
    const created = await api("/api/templates", { method: "POST", body: JSON.stringify(body) });
    currentTemplateId = created.id;
  } else {
    await api(`/api/templates/${currentTemplateId}`, { method: "PUT", body: JSON.stringify(body) });
  }

  await loadTemplates({ force: true });
  renderTemplatesList();
  if (currentTemplateId) await selectTemplate(currentTemplateId);
  setEditorStatus("Saved.");
}

async function deleteTemplate() {
  if (!currentTemplateId) return;
  await api(`/api/templates/${currentTemplateId}`, { method: "DELETE" });
  currentTemplateId = null;
  await loadTemplates({ force: true });
  renderTemplatesList();
  clearEditorForm();
  setEditorStatus("Deleted.");
}

/* UI wiring */
function on(id, event, handler) {
  const node = el(id);
  if (!node) {
    console.error(`[UI] Missing element #${id}`);
    return;
  }
  node.addEventListener(event, handler);
}

function wireUI() {
  on("goNewGame", "click", async () => {
    el("team1Input").value = teamNames[1];
    el("team2Input").value = teamNames[2];
    showScreen("screenTeams");
    try {
      await loadTemplates({ force: true });
    } catch (e) {
      openModal("Error", escapeHtml(String(e.message || e)));
      templatesCache = [];
    }
    gamePlanDraft = loadGamePlanDraft();
    saveGamePlanDraft();
    renderRoundPickList();
  });

  on("goEditRounds", "click", async () => {
    showScreen("screenEditor");
    clearEditorForm();
    setEditorStatus("Loading rounds…");
    await loadTemplates()
      .then(() => {
        renderTemplatesList();
        setEditorStatus("");
      })
      .catch((e) => setEditorStatus(String(e.message || e)));
  });

  on("tplImage", "change", async () => {
    try {
      const input = el("tplImage");
      if (!input || !input.files || !input.files[0]) {
        applyTemplateImage("");
        return;
      }

      const file = input.files[0];

      // Optional safety: avoid huge base64 in DB (you can adjust/remove)
      const maxBytes = 2.5 * 1024 * 1024; // 2.5MB
      if (file.size > maxBytes) {
        setEditorStatus("Image is too large. Please pick an image under ~2.5MB.");
        applyTemplateImage("");
        return;
      }

      const dataUrl = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result || ""));
        r.onerror = () => reject(new Error("Failed to read image file."));
        r.readAsDataURL(file);
      });

      applyTemplateImage(dataUrl);
      setEditorStatus("");
    } catch (e) {
      setEditorStatus(String(e.message || e));
      applyTemplateImage("");
    }
  });

  on("backToMenuFromTeams", "click", () => showScreen("screenMenu"));
  on("backToMenuFromEditor", "click", () => showScreen("screenMenu"));
  on("menuBtn", "click", () => showScreen("screenMenu"));

  on("startBtn", "click", async () => {
    const t1 = el("team1Input").value.trim() || "Team 1";
    const t2 = el("team2Input").value.trim() || "Team 2";
    teamNames = { 1: t1, 2: t2 };
    localStorage.setItem("team1", t1);
    localStorage.setItem("team2", t2);

    if (!gamePlanDraft.length) {
      openModal("Error", "Pick at least 1 round.");
      return;
    }
    if (gamePlanDraft.length > 10) {
      openModal("Error", "Pick up to 10 rounds.");
      return;
    }

    gamePlan = [...gamePlanDraft];
    localStorage.setItem("roundSet", gamePlan[0] || "builtin:movies"); // backward compat

    await startMatch();
  });

  on("addTemplateBtn", "click", () => {
    clearEditorForm();
    ensureTemplateKindControl();
    setEditorStatus("Fill the form and click Save.");
  });

  on("saveTemplateBtn", "click", async () => {
    try {
      await saveTemplate();
    } catch (e) {
      setEditorStatus(String(e.message || e));
    }
  });

  on("deleteTemplateBtn", "click", async () => {
    try {
      await deleteTemplate();
    } catch (e) {
      setEditorStatus(String(e.message || e));
    }
  });

  on("modalClose", "click", closeModal);

  const modal = el("modal");
  if (modal) {
    modal.addEventListener("click", (evt) => {
      if (evt.target === modal) closeModal();
    });
  }
}

(async function init() {
  wireUI();
  showScreen("screenMenu");
  await loadTemplates().catch(() => {});
})();

