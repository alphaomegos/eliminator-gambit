import { t, translateError } from "./i18n.js";

// Small DOM helpers shared by all screens.

export const $ = (id) => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node;
};

/** h("div", { class: "x", onclick }, child, "text") */
export function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "dataset") Object.assign(node.dataset, v);
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (k in node && typeof v !== "string") node[k] = v;
    else node.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function toggle(node, visible) {
  node.classList.toggle("hidden", !visible);
}

const SCREENS = ["screenBoot", "screenLogin", "screenMenu", "screenSetup", "screenGame", "screenEditor"];
let currentScreen = "screenBoot";

export function showScreen(name) {
  currentScreen = name;
  for (const s of SCREENS) toggle($(s), s === name);
  document.body.classList.toggle("modeGame", name === "screenGame");
  window.scrollTo(0, 0);
}
export const activeScreen = () => currentScreen;

export function errorMessage(err) {
  return translateError(String(err?.message ?? err ?? "Unknown error"));
}

// ---------- dialog ----------

let resolveDialog = null;

/**
 * Opens the shared dialog. Resolves with the clicked action's value,
 * or `null` when dismissed (Esc / backdrop).
 */
export function showDialog({ title = "", text = "", body = null, image = null, actions = [{ label: t("common.ok"), value: true }], wide = false }) {
  if (resolveDialog) resolveDialog(null);
  const modal = $("modal");
  $("modalTitle").textContent = title;
  const textNode = $("modalText");
  textNode.replaceChildren();
  if (body) textNode.append(body);
  else textNode.textContent = text;

  const imgWrap = $("modalImageWrap");
  toggle(imgWrap, !!image);
  if (image) $("modalImage").src = image;
  else $("modalImage").removeAttribute("src");

  $("modalCard").classList.toggle("wide", wide || !!image);
  const bar = $("modalActions");
  bar.replaceChildren(
    ...actions.map((a) =>
      h("button", { class: `btn ${a.variant || ""}`, type: "button", onclick: () => closeDialog(a.value) }, a.label),
    ),
  );
  toggle(modal, true);
  document.body.classList.add("modalOpen");
  queueMicrotask(() => bar.querySelector("button:last-child")?.focus());
  return new Promise((resolve) => (resolveDialog = resolve));
}

export function closeDialog(value = null) {
  toggle($("modal"), false);
  document.body.classList.remove("modalOpen");
  const r = resolveDialog;
  resolveDialog = null;
  r?.(value);
}

export const isDialogOpen = () => !!resolveDialog;

export function alertError(err, title = t("common.error")) {
  return showDialog({ title, text: errorMessage(err), actions: [{ label: t("common.ok"), value: true }] });
}

export async function confirmDialog(title, text, { ok = t("common.ok"), danger = false } = {}) {
  const v = await showDialog({
    title,
    text,
    actions: [
      { label: t("common.cancel"), value: false, variant: "secondary" },
      { label: ok, value: true, variant: danger ? "danger" : "" },
    ],
  });
  return v === true;
}

export function initDialog() {
  const modal = $("modal");
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeDialog(null);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && resolveDialog) closeDialog(null);
  });
}

/** Wraps an async click handler: disables the button and reports errors. */
export function busy(button, fn) {
  return async (...args) => {
    if (button.disabled) return;
    button.disabled = true;
    try {
      await fn(...args);
    } catch (e) {
      await alertError(e);
    } finally {
      button.disabled = false;
    }
  };
}
