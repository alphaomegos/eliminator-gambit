// Client-side image compression + upload.
import { api } from "./api.js";
import { t } from "./i18n.js";

const MAX_INPUT_BYTES = 15 * 1024 * 1024;

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(t("img.unreadable")));
    img.src = src;
  });
}

/** Downscale to `maxSide` and re-encode as JPEG (WebP if smaller). */
export async function compressImage(blob, { maxSide = 1600, quality = 0.82 } = {}) {
  if (blob.size > MAX_INPUT_BYTES) throw new Error(t("img.tooLarge"));
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    const w = img.naturalWidth || 1;
    const hgt = img.naturalHeight || 1;
    const scale = Math.min(1, maxSide / Math.max(w, hgt));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(hgt * scale);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const encode = (type) => new Promise((res) => canvas.toBlob(res, type, quality));
    const [jpeg, webp] = await Promise.all([encode("image/jpeg"), encode("image/webp")]);
    const best = webp && webp.type === "image/webp" && webp.size < jpeg.size ? webp : jpeg;
    if (!best) throw new Error(t("img.encode"));
    return best;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Compresses and uploads; resolves to { id, url }. */
export async function uploadImage(fileOrBlob) {
  const blob = await compressImage(fileOrBlob);
  return api("/api/images", { method: "POST", raw: blob, headers: { "content-type": blob.type } });
}

export async function urlToDataUrl(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not download image ${url}`);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("Could not read image"));
    r.readAsDataURL(blob);
  });
}

export async function dataUrlToBlob(dataUrl) {
  const res = await fetch(dataUrl);
  return res.blob();
}

/** Uploads an already-compressed image (used by import) without re-encoding. */
export async function uploadDataUrl(dataUrl) {
  let blob = await dataUrlToBlob(dataUrl);
  if (blob.size > 1_400_000) blob = await compressImage(blob);
  return api("/api/images", { method: "POST", raw: blob, headers: { "content-type": blob.type || "image/jpeg" } });
}
