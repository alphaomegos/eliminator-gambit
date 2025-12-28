const storage = {
  get(key, fallback = "") {
    try {
      const v = localStorage.getItem(key);
      return v ? v : fallback;
    } catch (_) {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, String(value));
    } catch (_) {}
  },
  getJSON(key, fallback = null) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch (_) {
      return fallback;
    }
  },
  setJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (_) {}
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch (_) {}
  },
};

let round = null;
let carouselIndex = 0;
let carouselItems = [];
let carouselOnPickItem = null;
let showAllOpen = false;
let gameSet = (storage.get("gameSet") || "").trim();

function setGameSet(name) {
  gameSet = String(name || "").trim().toUpperCase();
  if (gameSet) storage.set("gameSet", gameSet);
  else storage.remove("gameSet");
  // reset caches tied to dataset
  templatesCache = [];
  templatesLoadedAt = 0;
  currentTemplateId = null;
  itemImageCacheRoundId = null;
  itemImageCache = new Map();
}

let teamNames = {
  1: storage.get("team1", "Team 1"),
  2: storage.get("team2", "Team 2"),
};

let templatesCache = [];
let currentTemplateId = null;
let currentTemplateKind = "rated";
let templatesLoadedAt = 0;

// Cache item images locally so UI (Show image) doesn't disappear
// when backend returns "light" items (without image_data) after actions.
let itemImageCacheRoundId = null;
let itemImageCache = new Map(); // itemId -> image_data

function syncRoundItemImages(r, { reset = false } = {}) {
  if (!r || !Array.isArray(r.items)) return r;
  const rid = String(r.id ?? "");
  if (reset || itemImageCacheRoundId !== rid) {
    itemImageCacheRoundId = rid;
    itemImageCache = new Map();
  }
  // Remember any images we have
  for (const it of r.items) {
    if (it && it.id != null && it.image_data) {
      itemImageCache.set(String(it.id), it.image_data);
    }
  }
  // Re-apply cached images if backend omitted them
  r.items = r.items.map((it) => {
    if (!it || it.id == null || it.image_data) return it;
    const cached = itemImageCache.get(String(it.id));
    return cached ? { ...it, image_data: cached } : it;
  });
  return r;
}

/* Multi-round match state */
let gamePlanDraft = []; // what host selects on Teams screen (ordered)
let gamePlan = [];      // frozen plan for current match
let gameIndex = 0;      // current round index in gamePlan
let scores = { 1: 0, 2: 0 };

const ui = new Map();
const el = (id) => {
  const cached = ui.get(id);
  if (cached) {
    // If DOM was re-rendered and element got detached, re-query it.
    if (!cached.isConnected) ui.delete(id);
    else return cached;
  }
  const node = document.getElementById(id);
  if (node) ui.set(id, node); // Do not cache null/undefined.
  return node;
};

const uiEls = {
  get loginInput() { return el("loginInput"); },
  get loginSubmit() { return el("loginSubmit"); },
  get loginWarn() { return el("loginWarn"); },
  get team1Input() { return el("team1Input"); },
  get team2Input() { return el("team2Input"); },
  get itemModal() { return el("itemModal"); },
  get modal() { return el("modal"); },
  get tplImage() { return el("tplImage"); },
  get showAllBtn() { return el("showAllBtn"); },
  get showAllClose() { return el("showAllClose"); },
  get roundMedia() { return el("roundMedia"); },
  get itemsList() { return el("itemsList"); },
  get prompt() { return el("prompt"); },
};

function stopEvt(e) {
  if (!e) return;
  if (typeof e.preventDefault === "function") e.preventDefault();
  if (typeof e.stopPropagation === "function") e.stopPropagation();
}

function ensureNextRoundBtn() {
  const btn = el("nextRoundBtn");
  if (!btn) return null;
  if (!btn.dataset.bound) {
    btn.dataset.bound = "1";
    btn.type = btn.getAttribute("type") || "button";
    btn.addEventListener("click", async (e) => {
      stopEvt(e);
      await goNextRoundSafely();
    });
  }
  return btn;
}

function setNextRoundBtnVisible(visible) {
  const btn = ensureNextRoundBtn();
  if (!btn) return;
  setHidden(btn, !visible);
}

async function goNextRoundSafely() {
  const btn = el("nextRoundBtn");
  if (btn) btn.disabled = true;
  try {
    await goNextRound();
  } catch (err) {
    console.error(err);
    openError(err);
  } finally {
    if (btn) btn.disabled = false;
  }
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function errMsg(err) {
  if (typeof err === "string") return err;
  return String(err?.message ?? err ?? "Unknown error");
}

function setHidden(nodeOrId, hidden) {
  const node = typeof nodeOrId === "string" ? el(nodeOrId) : nodeOrId;
  if (!node) return null;
  node.classList.toggle("hidden", !!hidden);
  return node;
}

function openError(errOrMsg, title = "Error") {
  const msg =
    typeof errOrMsg === "string"
      ? errOrMsg
      : String(errOrMsg?.message ?? errOrMsg ?? "Unknown error");
  openModal(title, escapeHtml(msg));
}

async function runAsync(fn, onError) {
  try {
    return await fn();
  } catch (err) {
    if (typeof onError === "function") return onError(err);
    openError(err);
  }
}

function showScreen(name) {
  document.querySelectorAll(".screen").forEach((node) => {
    setHidden(node, node.id !== name);
  });
  setHidden("menuBtn", name === "screenMenu" || name === "screenLogin");
  document.body.classList.toggle("modeGame", name === "screenGame");
}

function openItemModal({ title, image_data, text }) {
  const modal = el("itemModal");
  const img = el("itemModalImage");
  const ttl = el("itemModalTitle");
  const txt = el("itemModalText");
  if (!modal || !img || !ttl || !txt) return;
  ttl.textContent = title || "";
  img.src = detectDataUrl(image_data || "");
  txt.textContent = text || "";
  setHidden(modal, false);
  document.body.classList.add("itemModalOpen");
}

function closeItemModal() {
  setHidden("itemModal", true);
  document.body.classList.remove("itemModalOpen");
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
  const t = el("modalTitle");
  const b = el("modalText");
  if (t) t.textContent = title;
  if (b) b.innerHTML = text;
  setHidden("modal", false);
}

function closeModal() {
  setHidden("modal", true);
}

async function api(path, options = {}) {
  const isGameSetEndpoint = String(path || "").startsWith("/api/game-sets");
  const headers = {
    ...(options.headers || {}),
    ...(options.body ? { "Content-Type": "application/json" } : {}),
  };
  if (!isGameSetEndpoint) {
    if (!gameSet) throw new Error("Not logged in. Please enter the name of your game set.");
    headers["X-Game-Set"] = gameSet;
  }
  const res = await fetch(path, {
    ...options,
    headers,
  });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const data = await res.json();
      if (data && data.detail) msg = data.detail;
    } catch (_) {}
    throw new Error(msg);
  }
  // Some endpoints might be empty responses
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) return null;
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
  const parsed = storage.getJSON("gamePlan", null);
  if (Array.isArray(parsed) && parsed.length) return parsed;
  const old = storage.get("roundSet", "");
  if (old) return [old];
  return ["builtin:movies"];
}

function saveGamePlanDraft() {
  storage.setJSON("gamePlan", gamePlanDraft);
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
    // Create the round instance.
    const created = await api("/api/rounds/from-template", {
      method: "POST",
      body: JSON.stringify({ template_id: templateId }),
    });
    // Some backends return "light" items for active rounds (without item.image_data).
    // Hydrate images from the template so "Show image" is available immediately.
    try {
      const items = Array.isArray(created?.items) ? created.items : [];
      const alreadyHasImages = items.some((it) => !!(it && it.image_data));
      if (!alreadyHasImages) {
        const tpl = await api(`/api/templates/${templateId}`);
        const tplItems = Array.isArray(tpl?.items) ? tpl.items : [];
        if (tplItems.length) {
          const byTitle = new Map();
          for (const t of tplItems) {
            const key = String(t?.title ?? "").trim();
            if (key && t?.image_data && !byTitle.has(key)) byTitle.set(key, t.image_data);
          }
          created.items = items.map((it, i) => {
            if (it && it.image_data) return it;
            const fromIndex = tplItems[i]?.image_data;
            const fromTitle = byTitle.get(String(it?.title ?? "").trim());
            const img = fromIndex || fromTitle || "";
            return { ...it, image_data: img };
          });
        }
      }
    } catch (_) {
      // If hydration fails we still can play the round; "Show image" just won't appear.
    }
    return created;
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
    setHidden(frame, true);
    img.removeAttribute("src");
    return;
  }
  setHidden(frame, false);
  img.src = detectDataUrl(data);
}

function renderGame() {
  if (!round) return;
  const kind = round.kind || "rated";
  setHidden(uiEls.showAllBtn, kind !== "carousel");
  if (kind !== "carousel" && showAllOpen) closeShowAllOverlay();
  setHidden(uiEls.roundMedia, kind !== "carousel");
  setHidden(uiEls.itemsList, kind === "carousel");
  if (uiEls.prompt) uiEls.prompt.textContent = round.prompt || "";
  updateTeamLabels();
  setActiveTeam(round.current_team);
  renderScores();
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
  if (kind === "carousel") {
    setMediaMode("carousel");
    const items = (round.items || []).map((it) => ({
      ...it,
      image_data: detectDataUrl(it.image_data || ""),
    }));
    renderCarousel(items);
    setNextRoundBtnVisible(isFinished && hasNextRound());
    return;
  }
  setMediaMode("single");
  renderRoundImage();
  const list = uiEls.itemsList;
  if (!list) return;
  list.innerHTML = "";
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
    if (item.rating != null) meta.textContent = `Rating: ${item.rating}`;
    else if (item.secret_text != null) meta.textContent = String(item.secret_text);
    else meta.textContent = "";
    if (item.eliminated) title.classList.add("eliminated");
    left.appendChild(title);
    left.appendChild(meta);
    const right = document.createElement("div");
    right.className = "itemRight";
    right.textContent = (item.eliminated && item.eliminated_by_team) ? (teamNames[item.eliminated_by_team] || "") : "";
    li.appendChild(left);
    li.appendChild(right);
    const modalText =
      item.secret_text != null ? String(item.secret_text) :
      (item.rating != null ? `Rating: ${item.rating}` : "");
    if (item.image_data) {
      li.classList.add("hasImage");
      const showImgBtn = document.createElement("button");
      showImgBtn.type = "button";
      showImgBtn.className = "btn secondary small showImageBtn";
      showImgBtn.textContent = "Show image";
      showImgBtn.addEventListener("click", (evt) => {
        stopEvt(evt);
        openItemModal({ title: item.title, image_data: item.image_data, text: modalText });
     });
      li.appendChild(showImgBtn);
    }
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
          openError(e);
        }
      });
      overlay.appendChild(btn);
      li.appendChild(overlay);
    }
    li.addEventListener("click", async () => {
      const finishedNow = round.status !== "active";
      if (!finishedNow && !item.eliminated) {
        await eliminate(item.id);
        return;
      }
      if (item.image_data) {
        const text =
          item.secret_text != null ? String(item.secret_text) :
          (item.rating != null ? `Rating: ${item.rating}` : "");
        openItemModal({ title: item.title, image_data: item.image_data, text });
      }
    });
    list.appendChild(li);
  }
  setNextRoundBtnVisible(isFinished && hasNextRound());
}

async function startRound() {
  closeModal();
  closeItemModal();
  carouselIndex = 0;
  try {
    round = await createRoundFor(getCurrentRoundSetId());
    round = syncRoundItemImages(round, { reset: true });
    showScreen("screenGame");
    renderGame();
  } catch (e) {
    openError(e);
  }
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
    const prevKind = round.kind || "rated";
    round = await api(`/api/rounds/${round.id}/eliminate`, {
      method: "POST",
      body: JSON.stringify({ item_id: itemId }),
    });
    round = syncRoundItemImages(round);
    const picked = round.items.find((x) => String(x.id) === String(itemId));
    const isFinished = round.status !== "active";
    const pickedWasTarget = !!(picked && isFinished && picked.is_target === true);
    if (pickedWasTarget) scores[actingTeam] = (scores[actingTeam] || 0) - 4;
    else scores[actingTeam] = (scores[actingTeam] || 0) + 1;
    renderGame();
    // For non-carousel rounds, show item image immediately after pick (if available).
    if (prevKind !== "carousel" && picked && picked.image_data) {
      const text =
        picked.secret_text != null ? String(picked.secret_text) :
        (picked.rating != null ? `Rating: ${picked.rating}` : "");
      openItemModal({ title: picked.title, image_data: picked.image_data, text });
    }
  } catch (e) {
    openError(e);
  }
}

/* ---------- Templates editor ---------- */
function setEditorStatus(text) {
  const n = el("editorStatus");
  if (n) n.textContent = text || "";
}

function detectDataUrl(data) {
  const s = String(data || "").trim();
  if (!s) return "";
  if (s.startsWith("data:")) return s;
  let mime = "image/png";
  if (s.startsWith("/9j/")) mime = "image/jpeg";
  else if (s.startsWith("iVBORw0KGgo")) mime = "image/png";
  else if (s.startsWith("R0lGOD")) mime = "image/gif";
  else if (s.startsWith("UklGR")) mime = "image/webp";
  return `data:${mime};base64,${s}`;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = () => reject(new Error("Failed to read image file."));
    r.readAsDataURL(file);
  });
}

async function fileToOptimizedDataUrl(file, { maxWidth = 1280, quality = 0.82 } = {}) {
  const src = await fileToDataUrl(file);
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("Failed to decode image."));
    i.src = src;
  });
  const w = img.naturalWidth || img.width || 1;
  const h = img.naturalHeight || img.height || 1;
  const outW = Math.min(w, maxWidth);
  const outH = Math.round(outW * (h / w));
  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");
  if (!ctx) return src;
  ctx.drawImage(img, 0, 0, outW, outH);
  return canvas.toDataURL("image/jpeg", quality);
}

function applyTemplateImage(data) {
  const hidden = el("tplImageData");
  const wrap = el("tplImagePreviewWrap");
  const img = el("tplImagePreview");
  const file = el("tplImage");
  const removeBtn = el("tplImageRemoveBtn");
  const has = !!data;
  if (hidden) hidden.value = has ? String(data) : "";
  if (file) file.value = "";
  // show/hide remove button
  setHidden(removeBtn, !has);
  if (!wrap || !img) return;
  if (!has) {
    setHidden(wrap, true);
    img.removeAttribute("src");
    return;
  }
  setHidden(wrap, false);
  img.src = detectDataUrl(data);
}

function setItemsHeaderHint(kind) {
  const editor = el("screenEditor");
  if (!editor) return;
  const hint = editor.querySelector(".itemsHeader .mutedSmall");
  if (!hint) return;
  if (kind === "rated") hint.textContent = "Title + rating + image (optional)";
  else if (kind === "carousel") hint.textContent = "Title + hidden info + target + image (required)";
  else hint.textContent = "Title + hidden info + target + image (optional)";
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
      currentTemplateKind === "rated"
        ? base.map((x) => ({ title: x.title, rating: "", image_data: "" }))
        : base.map((x) => ({ title: x.title, secret_text: "", is_target: false, image_data: "" }));
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
  const isManualLike = (kind === "manual" || kind === "carousel");
  for (const it of items || []) {
    if (isManualLike) {
      rows.push({
        title: it.title ?? "",
        secret_text: it.secret_text ?? "",
        is_target: !!it.is_target,
        image_data: it.image_data ?? "",
      });
    } else {
      rows.push({
        title: it.title ?? "",
        rating: it.rating ?? "",
        image_data: it.image_data ?? "",
      });
    }
  }
  while (rows.length < 11) {
    rows.push(
      isManualLike
        ? { title: "", secret_text: "", is_target: false, image_data: "" }
        : { title: "", rating: "", image_data: "" }
    );
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
    row.style.gridTemplateColumns =
      (kind === "rated") ? "1fr 140px 160px" : "1fr 1fr 44px 160px";
    const title = document.createElement("input");
    title.className = "input";
    title.placeholder = `Item ${idx + 1} title`;
    title.value = it.title ?? "";
    title.dataset.idx = String(idx);
    title.dataset.field = "title";
    row.appendChild(title);
    if (kind === "rated") {
      const rating = document.createElement("input");
      rating.className = "input";
      rating.placeholder = "Rating";
      rating.value = it.rating ?? "";
      rating.inputMode = "decimal";
      rating.dataset.idx = String(idx);
      rating.dataset.field = "rating";
      row.appendChild(rating);
    } else {
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
    }
    const imgCell = document.createElement("div");
    imgCell.className = "tplItemMedia";
    const imgHidden = document.createElement("input");
    imgHidden.type = "hidden";
    imgHidden.dataset.idx = String(idx);
    imgHidden.dataset.field = "image_data";
    imgHidden.value = it.image_data ?? "";
    const thumbWrap = document.createElement("div");
    thumbWrap.className = "tplItemThumbWrap";
    const thumb = document.createElement("img");
    thumb.className = "tplItemThumb";
    if (imgHidden.value) thumb.src = detectDataUrl(imgHidden.value);
    thumbWrap.appendChild(thumb);
    const file = document.createElement("input");
    file.type = "file";
    file.accept = "image/*";
    file.style.display = "none";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn secondary tplItemImgBtn";
    btn.textContent = "Image";
    btn.addEventListener("click", () => file.click());
    file.addEventListener("change", async () => {
      try {
        if (!file.files || !file.files[0]) return;
        const f = file.files[0];
        const maxBytes = 2.5 * 1024 * 1024;
        if (f.size > maxBytes) {
          setEditorStatus("Image is too large. Please pick an image under ~2.5MB.");
          return;
        }
        const dataUrl = await fileToOptimizedDataUrl(f);
        imgHidden.value = String(dataUrl || "");
        if (imgHidden.value) thumb.src = detectDataUrl(imgHidden.value);
        setEditorStatus("");
      } catch (e) {
        setEditorStatus(errMsg(e));
      }
    });
    imgCell.appendChild(thumbWrap);
    imgCell.appendChild(btn);
    imgCell.appendChild(file);
    imgCell.appendChild(imgHidden);
    row.appendChild(imgCell);
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
    image_data: "",
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
  const isManualLike = (kind === "manual" || kind === "carousel");
  const items = [];
  for (const r of rows) {
    const title = String(r.title || "").trim();
    const image_data = String(r.image_data || "");
    const hasAny =
      title ||
      String(r.rating || "").trim() ||
      String(r.secret_text || "").trim() ||
      !!r.is_target ||
      !!image_data;
    if (!hasAny) continue;
    if (!title) throw new Error("Each item must have a title.");
    if (isManualLike) {
      const secret = String(r.secret_text || "").trim();
      if (!secret) throw new Error("Manual/carousel round: each item must have hidden info.");
      items.push({ title, secret_text: secret, is_target: !!r.is_target, image_data });
    } else {
      const ratingRaw = String(r.rating || "").trim();
      const rating = Number(ratingRaw);
      if (!Number.isFinite(rating)) throw new Error("Rated round: each item must have a numeric rating.");
      items.push({ title, rating, image_data });
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
  if (kind === "manual" || kind === "carousel") {
    const targets = items.filter((x) => x.is_target);
    if (targets.length !== 1) throw new Error("Manual/carousel round: select exactly 1 target item.");
  }
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

function onClick(id, handler) {
  on(id, "click", handler);
}

function onClickStop(id, handler) {
  on(id, "click", (e) => {
    stopEvt(e);
    return handler(e);
  });
}

function onInput(id, handler) {
  on(id, "input", handler);
}

function onChange(id, handler) {
  on(id, "change", handler);
}

function onEnterStop(id, handler) {
  on(id, "keydown", async (e) => {
    if (e.key !== "Enter") return;
    stopEvt(e);
    return handler(e);
  });
}

function bindBackdropClose(id, closeFn) {
  const node = el(id);
  if (!node) return;
  if (node.dataset.backdropBound === "1") return;
  node.dataset.backdropBound = "1";
  node.addEventListener("click", (e) => {
    if (e.target === node) closeFn();
  });
}

async function renderLoginState() {
  const input = el("loginInput");
  const warn = el("loginWarn");
  const submit = el("loginSubmit");
  if (!input || !warn || !submit) return;
  // force uppercase
  const raw = String(input.value || "");
  const up = raw.toUpperCase();
  if (raw !== up) input.value = up;
  const val = up.trim();
  submit.disabled = val.length !== 6;
  if (val.length !== 6) {
    setHidden(warn, true);
    warn.dataset.exists = "";
    return;
  }
  try {
    const r = await api(`/api/game-sets/${encodeURIComponent(val)}`);
    const exists = !!(r && r.exists);
    warn.dataset.exists = exists ? "1" : "0";
    setHidden(warn, exists);
  } catch (e) {
    // If backend rejects (length etc) just hide warning
    setHidden(warn, true);
    warn.dataset.exists = "";
  }
}

async function doLoginSubmit() {
  const input = el("loginInput");
  const warn = el("loginWarn");
  if (!input || !warn) return;
  const name = String(input.value || "").trim().toUpperCase();
  if (name.length !== 6) {
    openError("Login must be exactly 6 characters.");
    return;
  }
  const existsFlag = warn.dataset.exists; // "1" / "0" / ""
  const exists = existsFlag === "1";
  if (!exists) {
    // create new
    await api(`/api/game-sets/${encodeURIComponent(name)}`, { method: "POST" });
  }
  setGameSet(name);
  showScreen("screenMenu");
}

function wireUI() {
  // Login screen
  onInput("loginInput", async () => {
    await renderLoginState();
  });
  // Enter = Submit
  onEnterStop("loginInput", async () => {
    const btn = uiEls.loginSubmit;
    if (!btn || btn.disabled) return;
    await runAsync(doLoginSubmit);
  });
  onClickStop("loginSubmit", () => runAsync(doLoginSubmit));
  // Logout
  onClickStop("logoutBtn", () => {
    setGameSet("");
    showScreen("screenLogin");

    const input = uiEls.loginInput;
    if (input) {
      input.value = "";
      input.focus();
    }
    setHidden(uiEls.loginWarn, true);
  });
  onClick("goNewGame", async () => {
    const t1 = uiEls.team1Input;
    const t2 = uiEls.team2Input;
    if (t1) t1.value = teamNames[1];
    if (t2) t2.value = teamNames[2];
    showScreen("screenTeams");
    await runAsync(
      () => loadTemplates({ force: true }),
      (e) => {
        openError(e);
        templatesCache = [];
      }
    );
    gamePlanDraft = loadGamePlanDraft();
    saveGamePlanDraft();
    renderRoundPickList();
  });
  onClick("itemModalClose", closeItemModal);
  bindBackdropClose("itemModal", closeItemModal);
  onClick("goEditRounds", async () => {
    showScreen("screenEditor");
    clearEditorForm();
    setEditorStatus("Loading rounds…");
    await runAsync(
      async () => {
        await loadTemplates();
        renderTemplatesList();
        setEditorStatus("");
      },
      (e) => setEditorStatus(errMsg(e))
    );
  });
  onChange("tplImage", async () => {
    try {
      const input = uiEls.tplImage;
      if (!input || !input.files || !input.files[0]) {
        applyTemplateImage("");
        return;
      }
      const file = input.files[0];
      const maxBytes = 2.5 * 1024 * 1024;
      if (file.size > maxBytes) {
        setEditorStatus("Image is too large. Please pick an image under ~2.5MB.");
        applyTemplateImage("");
        return;
      }
      const dataUrl = await fileToOptimizedDataUrl(file);
      applyTemplateImage(dataUrl);
      setEditorStatus("");
    } catch (e) {
      setEditorStatus(errMsg(e));
      applyTemplateImage("");
    }
  });
  onClickStop("tplImageRemoveBtn", () => {
    applyTemplateImage("");
    setEditorStatus("Image removed. Click Save to apply.");
  });
  onClick("backToMenuFromTeams", () => showScreen("screenMenu"));
  onClick("backToMenuFromEditor", () => showScreen("screenMenu"));
  onClick("menuBtn", () => showScreen("screenMenu"));
  if (el("showAllBtn")) onClickStop("showAllBtn", () => openShowAllOverlay());
  if (el("showAllClose")) onClickStop("showAllClose", () => closeShowAllOverlay());
  onClick("startBtn", async () => {
    const t1 = (uiEls.team1Input?.value ?? "").trim() || "Team 1";
    const t2 = (uiEls.team2Input?.value ?? "").trim() || "Team 2";
    teamNames = { 1: t1, 2: t2 };
    storage.set("team1", t1);
    storage.set("team2", t2);
    if (!gamePlanDraft.length) {
      openError("Pick at least 1 round.");
      return;
    }
    if (gamePlanDraft.length > 10) {
      openError("Pick up to 10 rounds.");
      return;
    }
    gamePlan = [...gamePlanDraft];
    storage.set("roundSet", gamePlan[0] || "builtin:movies");
    await startMatch();
  });
  onClick("addTemplateBtn", () => {
    clearEditorForm();
    ensureTemplateKindControl();
    setEditorStatus("Fill the form and click Save.");
  });
  onClick("saveTemplateBtn", () =>
    runAsync(saveTemplate, (e) => setEditorStatus(errMsg(e)))
  );
  onClick("deleteTemplateBtn", () =>
    runAsync(deleteTemplate, (e) => setEditorStatus(errMsg(e)))
  );
  onClick("modalClose", closeModal);
  bindBackdropClose("modal", closeModal);
}

function renderShowAllGrid() {
  const grid = el("showAllGrid");
  if (!grid) return;
  const items = (carouselItems && carouselItems.length)
    ? carouselItems
    : (round?.items || []);
  grid.innerHTML = items.map((it) => {
    const title = escapeHtml(it.title || "");
    const img = detectDataUrl(it.image_data || "");
    const classes = ["showAllItem", it.eliminated ? "eliminatedCard" : ""].filter(Boolean).join(" ");
    return `
      <div class="${classes}">
        <img src="${img}" alt="${title}">
        <div class="showAllCaption">${title}</div>
      </div>
    `;
  }).join("");
}

function openShowAllOverlay() {
  if (!round) return;
  const kind = round.kind || "rated";
  if (kind !== "carousel") return;
  renderShowAllGrid();
  const overlay = el("showAllOverlay");
  if (!overlay) return;
  showAllOpen = true;
  setHidden(overlay, false);
  overlay.setAttribute("aria-hidden", "false");
  document.body.classList.add("showAllOpen");
}

function closeShowAllOverlay() {
  const overlay = el("showAllOverlay");
  if (!overlay) return;
  showAllOpen = false;
  setHidden(overlay, true);
  overlay.setAttribute("aria-hidden", "true");
  document.body.classList.remove("showAllOpen");
}

(async function init() {
  wireUI();
  initCarouselControls(async (itemId) => {
    if (!round) return;
    const item = (round.items || []).find((x) => String(x.id) === String(itemId));
    const isFinished = round.status !== "active";
    if (!isFinished && item && !item.eliminated) {
      await eliminate(itemId);
      return;
    }
    if (item && item.image_data) {
      const text =
        item.secret_text != null ? String(item.secret_text) :
        (item.rating != null ? `Rating: ${item.rating}` : "");
      openItemModal({ title: item.title, image_data: item.image_data, text });
    }
  });
  if (!gameSet) {
    showScreen("screenLogin");
    el("loginInput")?.focus();
    await renderLoginState();
  } else {
    showScreen("screenMenu");
    await loadTemplates().catch(() => {});
  }
})();

function setMediaMode(mode) {
  const carouselFrame = document.getElementById("carouselFrame");
  if (!carouselFrame) return;
  setHidden(carouselFrame, mode !== "carousel");
}

function renderCarousel(items) {
  const isFinished = round?.status !== "active";
  carouselItems = (items || []).slice();
  if (isFinished) {
    const idx = carouselItems.findIndex((x) => x.is_target === true);
    if (idx >= 0) carouselIndex = idx;
  }
  const track = document.getElementById("carouselTrack");
  if (!track) return;
  track.innerHTML = carouselItems.map((it) => {
    const title = escapeHtml(it.title || "");
    const img = detectDataUrl(it.image_data || "");
    const classes = [
      "carouselItem",
      it.eliminated ? "eliminatedCard" : "",
      (isFinished && it.is_target === true) ? "losingPick" : "",
    ].filter(Boolean).join(" ");
    const nextOverlay =
      (isFinished && it.is_target === true && hasNextRound())
        ? `<div class="nextRoundOverlay" data-action="next-round"><span class="btn success">Next round</span></div>`
        : "";
    return `
      <div class="${classes}" data-item-id="${it.id}" role="button" tabindex="0" title="${title}">
        <img src="${img}" alt="${title}">
        <div class="carouselCaption">${title}</div>
        ${nextOverlay}
      </div>
    `;
  }).join("");
  updateCarouselTransform();
}

function getCarouselStepPx() {
  const track = document.getElementById("carouselTrack");
  const first = track.querySelector(".carouselItem");
  if (!first) return 0;
  const frame = document.getElementById("carouselFrame");
  const gap = parseFloat(getComputedStyle(frame).getPropertyValue("--gap")) || 12;
  return first.getBoundingClientRect().width + gap;
}

function getVisibleCount() {
  const frame = document.getElementById("carouselFrame");
  const v = parseFloat(getComputedStyle(frame).getPropertyValue("--visible"));
  return Number.isFinite(v) && v > 0 ? v : 5;
}

function updateCarouselTransform() {
  const track = document.getElementById("carouselTrack");
  const visible = getVisibleCount();
  const maxIndex = Math.max(0, carouselItems.length - visible);
  if (carouselIndex > maxIndex) carouselIndex = 0;
  if (carouselIndex < 0) carouselIndex = maxIndex;
  const step = getCarouselStepPx();
  track.style.transform = `translateX(${-carouselIndex * step}px)`;
}

function initCarouselControls(onPickItem) {
  carouselOnPickItem = onPickItem;
  const prev = document.getElementById("carouselPrev");
  const next = document.getElementById("carouselNext");
  const track = document.getElementById("carouselTrack");
  if (!prev || !next || !track) return;
  prev.onclick = () => {
    carouselIndex -= 1;
    updateCarouselTransform();
  };
  next.onclick = () => {
    carouselIndex += 1;
    updateCarouselTransform();
  };
  // Bind addEventListener only once.
  if (track.dataset.bound === "1") return;
  track.dataset.bound = "1";
  window.addEventListener("resize", () => updateCarouselTransform());
  track.addEventListener("click", async (e) => {
    const nextAction = e.target.closest('[data-action="next-round"]');
    if (nextAction) {
      stopEvt(e);
      await goNextRoundSafely();
      return;
    }
    const card = e.target.closest(".carouselItem");
    if (!card) return;
    const itemId = card.dataset.itemId;
    if (itemId) await carouselOnPickItem?.(itemId);
  });
}
