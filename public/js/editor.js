import { del, get, post, put } from "./api.js";
import { $, alertError, confirmDialog, errorMessage, h, showDialog } from "./dom.js";
import { uploadDataUrl, uploadImage, urlToDataUrl } from "./images.js";

const MAX_ITEMS = 11;
const EXPORT_FORMAT = "eliminators-gambit/v1";

let templates = [];
let model = null;
let dirty = false;
let onBackCb = () => {};

const emptyItem = () => ({ title: "", rating: "", secret_text: "", is_target: false, image: null });
const blankModel = (kind = "rated") => ({
  id: null,
  kind,
  name: "",
  prompt: "",
  image: null,
  items: Array.from({ length: MAX_ITEMS }, emptyItem),
});

function setStatus(text, kind = "") {
  const n = $("editorStatus");
  n.textContent = text || "";
  n.className = `status ${kind}`;
}

function markDirty() {
  dirty = true;
  setStatus("Unsaved changes", "muted");
}

async function confirmDiscard() {
  if (!dirty) return true;
  return confirmDialog("Discard changes?", "This round has unsaved changes.", { ok: "Discard", danger: true });
}

// ---------- image picker ----------

function imagePicker({ get: getImg, set: setImg, compact = false }) {
  const file = h("input", { type: "file", accept: "image/*", class: "hidden" });
  const wrap = h("div", { class: `imagePickerInner${compact ? " compact" : ""}` });

  const render = () => {
    const img = getImg();
    // Note: native replaceChildren() would stringify nulls, so filter them out.
    const parts = [
      h("div", { class: "thumb", onclick: () => file.click() }, img ? h("img", { src: img.url, alt: "" }) : h("span", {}, "+")),
      h("button", { class: "btn small secondary", type: "button", onclick: () => file.click() }, img ? "Replace" : "Image"),
      img
        ? h(
            "button",
            {
              class: "btn small secondary iconBtn",
              type: "button",
              title: "Remove image",
              onclick: () => {
                setImg(null);
                markDirty();
                render();
              },
            },
            "×",
          )
        : null,
      file,
    ];
    wrap.replaceChildren(...parts.filter(Boolean));
  };

  file.addEventListener("change", async () => {
    const f = file.files?.[0];
    file.value = "";
    if (!f) return;
    wrap.classList.add("loading");
    try {
      const up = await uploadImage(f);
      setImg({ id: up.id, url: up.url });
      markDirty();
      render();
    } catch (e) {
      setStatus(errorMessage(e), "error");
    } finally {
      wrap.classList.remove("loading");
    }
  });

  render();
  return wrap;
}

// ---------- form ----------

function renderItems() {
  const { kind } = model;
  $("itemsHint").textContent =
    kind === "rated"
      ? "Title + rating. Lowest rating is the target. Image optional."
      : kind === "carousel"
        ? "Title + hidden info + image (required). Pick the target with ◉."
        : "Title + hidden info. Pick the target with ◉. Image optional.";

  $("tplItems").replaceChildren(
    ...model.items.map((it, idx) => {
      const field = (name, attrs) =>
        h("input", {
          class: "input",
          value: it[name] ?? "",
          ...attrs,
          oninput: (e) => {
            it[name] = e.target.value;
            markDirty();
          },
        });
      return h(
        "div",
        { class: `tplItemRow kind-${kind}` },
        h("span", { class: "rowNum" }, String(idx + 1)),
        field("title", { placeholder: `Item ${idx + 1}`, maxlength: "200", "aria-label": `Item ${idx + 1} title` }),
        kind === "rated"
          ? field("rating", { placeholder: "Rating", inputmode: "decimal", "aria-label": `Item ${idx + 1} rating` })
          : field("secret_text", { placeholder: "Hidden info", maxlength: "500", "aria-label": `Item ${idx + 1} hidden info` }),
        kind === "rated"
          ? null
          : h(
              "label",
              { class: "targetPick", title: "Target (the one to avoid)" },
              h("input", {
                type: "radio",
                name: "targetPick",
                checked: !!it.is_target,
                onchange: () => {
                  model.items.forEach((x, j) => (x.is_target = j === idx));
                  markDirty();
                },
              }),
            ),
        imagePicker({ get: () => it.image, set: (v) => (it.image = v), compact: true }),
      );
    }),
  );
}

function renderForm() {
  $("tplKind").value = model.kind;
  $("tplName").value = model.name;
  $("tplPrompt").value = model.prompt;
  $("tplImagePicker").replaceChildren(imagePicker({ get: () => model.image, set: (v) => (model.image = v) }));
  renderItems();
  $("editorDelete").disabled = !model.id;
  $("editorDuplicate").disabled = !model.id;
}

function renderList() {
  const box = $("templatesList");
  if (!templates.length) {
    box.replaceChildren(h("div", { class: "hint" }, "No rounds yet. Fill in the form and press Save."));
    return;
  }
  box.replaceChildren(
    ...templates.map((t) =>
      h(
        "button",
        {
          type: "button",
          class: `tplRow${model?.id === t.id ? " active" : ""}`,
          onclick: () => selectTemplate(t.id),
        },
        h("div", { class: "tplRowName" }, t.name),
        h("div", { class: "tplRowMeta" }, `${t.kind} · ${t.item_count} items`),
      ),
    ),
  );
}

function fromServer(tpl) {
  const items = tpl.items.map((it) => ({
    title: it.title ?? "",
    rating: it.rating ?? "",
    secret_text: it.secret_text ?? "",
    is_target: !!it.is_target,
    image: it.image_id ? { id: it.image_id, url: it.image_url } : null,
  }));
  while (items.length < MAX_ITEMS) items.push(emptyItem());
  return {
    id: tpl.id,
    kind: tpl.kind,
    name: tpl.name,
    prompt: tpl.prompt,
    image: tpl.image_id ? { id: tpl.image_id, url: tpl.image_url } : null,
    items,
  };
}

function toPayload(m) {
  const filled = m.items.filter(
    (it) => String(it.title).trim() || String(it.rating).trim() || String(it.secret_text).trim() || it.image || it.is_target,
  );
  return {
    kind: m.kind,
    name: m.name.trim(),
    prompt: m.prompt.trim(),
    image_id: m.image?.id ?? null,
    items: filled.map((it) => ({
      title: String(it.title).trim(),
      rating: m.kind === "rated" ? String(it.rating).trim().replace(",", ".") : null,
      secret_text: m.kind === "rated" ? null : String(it.secret_text).trim(),
      is_target: m.kind !== "rated" && !!it.is_target,
      image_id: it.image?.id ?? null,
    })),
  };
}

async function loadList() {
  templates = (await get("/api/templates")).templates;
  renderList();
}

async function selectTemplate(id) {
  if (model?.id === id) return;
  if (!(await confirmDiscard())) return;
  try {
    model = fromServer(await get(`/api/templates/${id}`));
    dirty = false;
    setStatus("");
    renderForm();
    renderList();
  } catch (e) {
    await alertError(e);
  }
}

function newTemplate(kind = "rated") {
  model = blankModel(kind);
  dirty = false;
  setStatus("");
  renderForm();
  renderList();
  $("tplName").focus();
}

async function save() {
  const payload = toPayload(model);
  const btn = $("editorSave");
  btn.disabled = true;
  try {
    const saved = model.id ? await put(`/api/templates/${model.id}`, payload) : await post("/api/templates", payload);
    model = fromServer(saved);
    dirty = false;
    renderForm();
    await loadList();
    setStatus("Saved ✓", "ok");
  } catch (e) {
    setStatus(errorMessage(e), "error");
  } finally {
    btn.disabled = false;
  }
}

async function remove() {
  if (!model?.id) return;
  if (!(await confirmDialog("Delete round?", `“${model.name}” will be deleted permanently.`, { ok: "Delete", danger: true }))) return;
  try {
    await del(`/api/templates/${model.id}`);
    await loadList();
    newTemplate();
    setStatus("Deleted", "muted");
  } catch (e) {
    await alertError(e);
  }
}

function duplicate() {
  if (!model?.id) return;
  model = { ...structuredClone(model), id: null, name: `${model.name} (copy)` };
  renderForm();
  renderList();
  markDirty();
}

// ---------- import / export ----------

async function exportAll() {
  const btn = $("editorExport");
  btn.disabled = true;
  setStatus("Preparing export…", "muted");
  try {
    const cache = new Map();
    const inline = async (url) => {
      if (!url) return null;
      if (!cache.has(url)) cache.set(url, await urlToDataUrl(url));
      return cache.get(url);
    };
    const out = [];
    for (const t of templates) {
      const tpl = await get(`/api/templates/${t.id}`);
      out.push({
        kind: tpl.kind,
        name: tpl.name,
        prompt: tpl.prompt,
        image: await inline(tpl.image_url),
        items: await Promise.all(
          tpl.items.map(async (it) => ({
            title: it.title,
            rating: it.rating,
            secret_text: it.secret_text,
            is_target: it.is_target,
            image: await inline(it.image_url),
          })),
        ),
      });
    }
    const blob = new Blob([JSON.stringify({ format: EXPORT_FORMAT, exported_at: new Date().toISOString(), templates: out }, null, 1)], {
      type: "application/json",
    });
    const a = h("a", { href: URL.createObjectURL(blob), download: `eliminators-gambit-rounds-${new Date().toISOString().slice(0, 10)}.json` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    setStatus(`Exported ${out.length} rounds`, "ok");
  } catch (e) {
    setStatus(errorMessage(e), "error");
  } finally {
    btn.disabled = false;
  }
}

async function importFile(file) {
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    return alertError("That file is not valid JSON.");
  }
  const list = Array.isArray(data?.templates) ? data.templates : null;
  if (data?.format !== EXPORT_FORMAT || !list) return alertError("This is not an Eliminator’s Gambit export file.");
  if (!(await confirmDialog("Import rounds?", `${list.length} rounds will be added to this game set.`, { ok: "Import" }))) return;

  let ok = 0;
  const failed = [];
  for (const [i, t] of list.entries()) {
    setStatus(`Importing ${i + 1} / ${list.length}…`, "muted");
    try {
      const img = async (d) => (d ? (await uploadDataUrl(d)).id : null);
      await post("/api/templates", {
        kind: t.kind,
        name: t.name,
        prompt: t.prompt,
        image_id: await img(t.image),
        items: await Promise.all(
          (t.items || []).map(async (it) => ({
            title: it.title,
            rating: it.rating,
            secret_text: it.secret_text,
            is_target: !!it.is_target,
            image_id: await img(it.image),
          })),
        ),
      });
      ok++;
    } catch (e) {
      failed.push(`${t?.name || `#${i + 1}`}: ${errorMessage(e)}`);
    }
  }
  await loadList();
  setStatus(`Imported ${ok} of ${list.length}`, failed.length ? "error" : "ok");
  if (failed.length) await showDialog({ title: "Some rounds were skipped", text: failed.join("\n") });
}

// ---------- public ----------

export function initEditor({ onBack }) {
  onBackCb = onBack;
  $("tplKind").addEventListener("change", (e) => {
    model.kind = e.target.value;
    renderItems();
    markDirty();
  });
  $("tplName").addEventListener("input", (e) => {
    model.name = e.target.value;
    markDirty();
  });
  $("tplPrompt").addEventListener("input", (e) => {
    model.prompt = e.target.value;
    markDirty();
  });
  $("editorForm").addEventListener("submit", (e) => {
    e.preventDefault();
    save();
  });
  $("editorDelete").addEventListener("click", remove);
  $("editorDuplicate").addEventListener("click", duplicate);
  $("editorAdd").addEventListener("click", async () => {
    if (await confirmDiscard()) newTemplate(model?.kind);
  });
  $("editorBack").addEventListener("click", async () => {
    if (await confirmDiscard()) {
      dirty = false;
      onBackCb();
    }
  });
  $("editorExport").addEventListener("click", exportAll);
  $("editorImport").addEventListener("click", () => $("editorImportFile").click());
  $("editorImportFile").addEventListener("change", async (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (f) await importFile(f);
  });
  window.addEventListener("beforeunload", (e) => {
    if (dirty) e.preventDefault();
  });
}

export async function showEditor() {
  newTemplate();
  $("templatesList").replaceChildren(h("div", { class: "hint" }, "Loading…"));
  try {
    await loadList();
  } catch (e) {
    setStatus(errorMessage(e), "error");
  }
}
