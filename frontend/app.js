let round = null;

let teamNames = {
  1: localStorage.getItem("team1") || "Team 1",
  2: localStorage.getItem("team2") || "Team 2",
};

let roundSet = localStorage.getItem("roundSet") || "builtin:movies";

let templatesCache = [];
let currentTemplateId = null;
let currentTemplateKind = "rated";
let currentTemplateImageData = null;

const el = (id) => document.getElementById(id);

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function showScreen(name) {
  const screens = ["screenMenu", "screenTeams", "screenGame", "screenEditor"];
  for (const s of screens) el(s).classList.toggle("hidden", s !== name);
  el("menuBtn").classList.toggle("hidden", name === "screenMenu");
}

function setActiveTeam(team) {
  el("team1").classList.toggle("active", team === 1);
  el("team2").classList.toggle("active", team === 2);
}

function updateTeamLabels() {
  el("team1").textContent = teamNames[1];
  el("team2").textContent = teamNames[2];
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

function setRoundImage(dataUrl) {
  const frame = el("roundImageFrame");
  const img = el("roundImage");
  if (!frame || !img) return;

  if (dataUrl) {
    img.src = dataUrl;
    frame.classList.remove("hidden");
  } else {
    img.removeAttribute("src");
    frame.classList.add("hidden");
  }
}

function setTemplateImagePreview(dataUrl) {
  const wrap = el("tplImagePreviewWrap");
  const img = el("tplImagePreview");
  if (!wrap || !img) return;

  if (dataUrl) {
    img.src = dataUrl;
    wrap.classList.remove("hidden");
  } else {
    img.removeAttribute("src");
    wrap.classList.add("hidden");
  }
}

function renderGame() {
  if (!round) return;

  el("prompt").textContent = round.prompt;
  updateTeamLabels();
  setActiveTeam(round.current_team);

  setRoundImage(round.image_data || null);

  const list = el("itemsList");
  list.innerHTML = "";

  const isFinished = round.status === "finished";

  for (const item of round.items) {
    const li = document.createElement("li");
    li.className = "item";

    const clickable = !item.eliminated && !isFinished;
    li.classList.add(clickable ? "clickable" : "notClickable");

    const isLosingPick = isFinished && item.eliminated && item.is_target === true;
    if (isLosingPick) li.classList.add("losingPick");

    const left = document.createElement("div");

    const title = document.createElement("div");
    title.className = "itemTitle";
    title.textContent = item.title;

    const meta = document.createElement("div");
    meta.className = "itemMeta";

    // Backend hides rating/secret_text until eliminated (or round finished).
    if (item.rating != null) {
      meta.textContent = `Rating: ${item.rating}`;
    } else if (item.secret_text != null) {
      meta.textContent = String(item.secret_text);
    } else {
      meta.textContent = "";
    }

    if (item.eliminated) {
      title.classList.add("eliminated");
    }

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

    li.addEventListener("click", async () => {
      if (!clickable) return;
      await eliminate(item.id);
    });

    list.appendChild(li);
  }

  if (isFinished) {
    const winnerName = round.winner_team ? teamNames[round.winner_team] : "Winner";
    const loserName = round.loser_team ? teamNames[round.loser_team] : "Loser";
    const title = `${winnerName} wins!`;

    const target = round.items.find((x) => x.is_target);
    let targetLine = "Target not found.";

    if (target) {
      if (target.rating != null) {
        targetLine = `The target was: <b>${escapeHtml(target.title)}</b> (rating ${escapeHtml(
          target.rating
        )}).`;
      } else if (target.secret_text != null) {
        targetLine = `The target was: <b>${escapeHtml(target.title)}</b>.<br/>Hidden info: <b>${escapeHtml(
          target.secret_text
        )}</b>`;
      } else {
        targetLine = `The target was: <b>${escapeHtml(target.title)}</b>.`;
      }
    }

    openModal(title, `${escapeHtml(loserName)} loses.<br/><br/>${targetLine}`);
  }
}

async function createRoundFromRoundSet() {
  if (roundSet.startsWith("template:")) {
    const templateId = roundSet.slice("template:".length);
    round = await api("/api/rounds/from-template", {
      method: "POST",
      body: JSON.stringify({ template_id: templateId }),
    });
    return;
  }

  round = await api("/api/rounds", {
    method: "POST",
    body: JSON.stringify({ category: "movies" }),
  });
}

async function startGame() {
  closeModal();
  await createRoundFromRoundSet();
  showScreen("screenGame");
  renderGame();
}

async function eliminate(itemId) {
  try {
    round = await api(`/api/rounds/${round.id}/eliminate`, {
      method: "POST",
      body: JSON.stringify({ item_id: itemId }),
    });
    renderGame();
  } catch (e) {
    openModal("Error", escapeHtml(String(e.message || e)));
  }
}

/* Templates editor */
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
    if (!Number.isNaN(idx) && idx >= 0 && idx <= 10) {
      titles[idx] = inp.value ?? "";
    }
  }
  return titles.map((t) => ({ title: t }));
}

function setEditorStatus(text) {
  el("editorStatus").textContent = text || "";
}

function renderTemplatesList() {
  const box = el("templatesList");
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

function renderRoundSetSelect() {
  const s = el("roundSetSelect");
  s.innerHTML = "";

  const optBuiltin = document.createElement("option");
  optBuiltin.value = "builtin:movies";
  optBuiltin.textContent = "Built-in: Movies (random 11)";
  s.appendChild(optBuiltin);

  for (const t of templatesCache) {
    const opt = document.createElement("option");
    opt.value = `template:${t.id}`;
    opt.textContent = `${t.name}`;
    s.appendChild(opt);
  }

  // If selected value no longer exists, keep builtin.
  s.value = roundSet;
  if (s.value !== roundSet) {
    roundSet = "builtin:movies";
    s.value = roundSet;
  }
}

function ensureTemplateKindControl() {
  let kindSel = el("tplKind");

  if (!kindSel) return;

  if (kindSel.dataset.bound === "1") {
    currentTemplateKind = kindSel.value || currentTemplateKind || "rated";
    setItemsHeaderHint(currentTemplateKind);
    return;
  }

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
  return k && k.value ? k.value : currentTemplateKind || "rated";
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
  box.innerHTML = "";

  const rows = normalizeItemsTo11(items, kind);

  rows.forEach((it, idx) => {
    const row = document.createElement("div");
    row.className = "tplItemRow";

    // Override columns without touching CSS:
    row.style.display = "grid";
    row.style.gap = "10px";
    row.style.gridTemplateColumns = kind === "manual" ? "1fr 1fr 44px" : "1fr 140px";

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

    if (field === "is_target") {
      rows[idx][field] = !!inp.checked;
    } else {
      rows[idx][field] = inp.value;
    }
  }

  const items = [];
  for (const r of rows) {
    const title = String(r.title || "").trim();

    const hasAny =
      title || String(r.rating || "").trim() || String(r.secret_text || "").trim() || !!r.is_target;

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

let templatesLoadedAt = 0;

async function loadTemplates({ force = false } = {}) {
  const now = Date.now();
  if (!force && templatesCache.length && now - templatesLoadedAt < 30000) {
    renderTemplatesList();
    renderRoundSetSelect();
    return;
  }

  try {
    const data = await api("/api/templates");
    templatesCache = data.templates || [];
    templatesLoadedAt = now;
  } catch (e) {
    templatesCache = [];
  }

  renderTemplatesList();
  renderRoundSetSelect();
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

  currentTemplateImageData = tpl.image_data || null;
  setTemplateImagePreview(currentTemplateImageData);

  const fileInp = el("tplImage");
  if (fileInp) fileInp.value = "";

  renderTemplateItemsForm(tpl.items || [], currentTemplateKind);
}

function clearEditorForm() {
  currentTemplateId = null;
  el("tplName").value = "";
  el("tplPrompt").value = "";

  ensureTemplateKindControl();
  currentTemplateKind = "rated";
  const k = el("tplKind");
  if (k) k.value = "rated";

  currentTemplateImageData = null;
  setTemplateImagePreview(null);

  const fileInp = el("tplImage");
  if (fileInp) fileInp.value = "";

  renderTemplateItemsForm([], "rated");
  renderTemplatesList();
  setEditorStatus("");
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

  const body = { kind, name, prompt, items, image_data: currentTemplateImageData };

  if (!currentTemplateId) {
    const created = await api("/api/templates", {
      method: "POST",
      body: JSON.stringify(body),
    });
    currentTemplateId = created.id;
  } else {
    await api(`/api/templates/${currentTemplateId}`, {
      method: "PUT",
      body: JSON.stringify(body),
    });
  }

  await loadTemplates({ force: true });
  if (currentTemplateId) await selectTemplate(currentTemplateId);
  setEditorStatus("Saved.");
}

async function deleteTemplate() {
  if (!currentTemplateId) return;
  await api(`/api/templates/${currentTemplateId}`, { method: "DELETE" });
  currentTemplateId = null;
  await loadTemplates({ force: true });
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
  on("goNewGame", "click", () => {
    el("team1Input").value = teamNames[1];
    el("team2Input").value = teamNames[2];
    showScreen("screenTeams");

    loadTemplates()
      .then(() => {
        el("roundSetSelect").value = roundSet;
      })
      .catch(() => {});
  });

  on("goEditRounds", "click", () => {
    showScreen("screenEditor");
    clearEditorForm();
    setEditorStatus("Loading rounds…");

    loadTemplates()
      .then(() => setEditorStatus(""))
      .catch((e) => setEditorStatus(String(e.message || e)));
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

    roundSet = el("roundSetSelect").value || "builtin:movies";
    localStorage.setItem("roundSet", roundSet);

    await startGame();
  });

  on("addTemplateBtn", "click", () => {
    clearEditorForm();
    ensureTemplateKindControl();
    setEditorStatus("Fill the form and click Save.");
  });

  on("tplImage", "change", async (e) => {
    try {
      const inp = e.target;
      const file = inp.files && inp.files[0];

      if (!file) {
        currentTemplateImageData = null;
        setTemplateImagePreview(null);
        return;
      }

      if (file.size > 1_500_000) {
        inp.value = "";
        currentTemplateImageData = null;
        setTemplateImagePreview(null);
        throw new Error("Image is too large (max ~1.5MB).");
      }

      const dataUrl = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = reject;
        r.readAsDataURL(file);
      });

      currentTemplateImageData = String(dataUrl);
      setTemplateImagePreview(currentTemplateImageData);
    } catch (err) {
      setEditorStatus(String(err.message || err));
    }
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
  on("modalNewRound", "click", async () => {
    try {
      await startGame();
    } catch (e) {
      openModal("Error", escapeHtml(String(e.message || e)));
    }
  });

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
  loadTemplates().catch(() => {});
})();

