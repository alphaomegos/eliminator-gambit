import { del, get, post, put } from "./api.js";
import { $, alertError, confirmDialog, errorMessage, h, showDialog } from "./dom.js";
import { uploadDataUrl, uploadImage, urlToDataUrl } from "./images.js";
import { onLangChange, t } from "./i18n.js";

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
  setStatus(t("editor.unsaved"), "muted");
}

async function confirmDiscard() {
  if (!dirty) return true;
  return confirmDialog(t("editor.discardTitle"), t("editor.discardText"), { ok: t("editor.discard"), danger: true });
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
      h("button", { class: "btn small secondary", type: "button", onclick: () => file.click() }, t(img ? "editor.replace" : "editor.image")),
      img
        ? h(
            "button",
            {
              class: "btn small secondary iconBtn",
              type: "button",
              title: t("editor.removeImage"),
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
    kind === "rated" ? t("editor.hintRated") : kind === "carousel" ? t("editor.hintCarousel") : t("editor.hintManual");

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
        field("title", { placeholder: t("editor.item", { n: idx + 1 }), maxlength: "200", "aria-label": t("editor.itemTitle", { n: idx + 1 }) }),
        kind === "rated"
          ? field("rating", { placeholder: t("editor.rating"), inputmode: "decimal", "aria-label": t("editor.itemRating", { n: idx + 1 }) })
          : field("secret_text", { placeholder: t("editor.secret"), maxlength: "500", "aria-label": t("editor.itemSecret", { n: idx + 1 }) }),
        kind === "rated"
          ? null
          : h(
              "label",
              { class: "targetPick", title: t("editor.target") },
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
    box.replaceChildren(h("div", { class: "hint" }, t("editor.empty")));
    return;
  }
  box.replaceChildren(
    ...templates.map((tpl) =>
      h(
        "button",
        {
          type: "button",
          class: `tplRow${model?.id === tpl.id ? " active" : ""}`,
          onclick: () => selectTemplate(tpl.id),
        },
        h("div", { class: "tplRowName" }, tpl.name),
        h("div", { class: "tplRowMeta" }, `${t(`kind.${tpl.kind}`)} · ${t("items.count", { n: tpl.item_count })}`),
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
    setStatus(t("editor.saved"), "ok");
  } catch (e) {
    setStatus(errorMessage(e), "error");
  } finally {
    btn.disabled = false;
  }
}

async function remove() {
  if (!model?.id) return;
  if (!(await confirmDialog(t("editor.deleteTitle"), t("editor.deleteText", { name: model.name }), { ok: t("editor.delete"), danger: true }))) return;
  try {
    await del(`/api/templates/${model.id}`);
    await loadList();
    newTemplate();
    setStatus(t("editor.deleted"), "muted");
  } catch (e) {
    await alertError(e);
  }
}

function duplicate() {
  if (!model?.id) return;
  model = { ...structuredClone(model), id: null, name: t("editor.copy", { name: model.name }) };
  renderForm();
  renderList();
  markDirty();
}

// ---------- import / export ----------

async function exportAll() {
  const btn = $("editorExport");
  btn.disabled = true;
  setStatus(t("editor.exporting"), "muted");
  try {
    const cache = new Map();
    const inline = async (url) => {
      if (!url) return null;
      if (!cache.has(url)) cache.set(url, await urlToDataUrl(url));
      return cache.get(url);
    };
    const out = [];
    for (const summary of templates) {
      const tpl = await get(`/api/templates/${summary.id}`);
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
    setStatus(t("editor.exported", { n: out.length }), "ok");
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
    return alertError(t("editor.badJson"));
  }
  const list = Array.isArray(data?.templates) ? data.templates : null;
  if (data?.format !== EXPORT_FORMAT || !list) return alertError(t("editor.badFile"));
  if (!(await confirmDialog(t("editor.importTitle"), t("editor.importText", { n: list.length }), { ok: t("editor.import") }))) return;

  let ok = 0;
  const failed = [];
  for (const [i, item] of list.entries()) {
    setStatus(t("editor.importing", { i: i + 1, n: list.length }), "muted");
    try {
      const img = async (d) => (d ? (await uploadDataUrl(d)).id : null);
      await post("/api/templates", {
        kind: item.kind,
        name: item.name,
        prompt: item.prompt,
        image_id: await img(item.image),
        items: await Promise.all(
          (item.items || []).map(async (it) => ({
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
      failed.push(`${item?.name || `#${i + 1}`}: ${errorMessage(e)}`);
    }
  }
  await loadList();
  setStatus(t("editor.imported", { ok, n: list.length }), failed.length ? "error" : "ok");
  if (failed.length) await showDialog({ title: t("editor.skipped"), text: failed.join("\n") });
}

// ---------- public ----------

export function initEditor({ onBack }) {
  onLangChange(() => {
    if (!model) return;
    renderForm();
    renderList();
    if (dirty) setStatus(t("editor.unsaved"), "muted");
  });
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
