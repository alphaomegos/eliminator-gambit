import { requireGameSet, sha256Hex } from "./auth";
import { Env, HttpError, json, now, type Handler } from "./http";

export const MAX_IMAGE_BYTES = 1_500_000; // D1 rows are capped at 2 MB
const ID_RE = /^[0-9a-f]{64}$/;

function sniffMime(b: Uint8Array): string | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45) return "image/webp";
  return null;
}

export const imageUrl = (id: string | null | undefined): string | null => (id ? `/api/images/${id}` : null);

export async function storeImage(env: Env, gameSet: string, bytes: Uint8Array): Promise<string> {
  if (bytes.byteLength === 0) throw new HttpError(400, "Empty image");
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new HttpError(413, "Image is too large (max 1.5 MB after compression)");
  const mime = sniffMime(bytes);
  if (!mime) throw new HttpError(415, "Unsupported image format (use JPEG, PNG, WebP or GIF)");
  const id = await sha256Hex(bytes);
  await env.DB.prepare("INSERT OR IGNORE INTO images (id, game_set, mime, bytes, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(id, gameSet, mime, bytes, now())
    .run();
  return id;
}

export async function assertImagesExist(env: Env, ids: (string | null)[]): Promise<void> {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  for (const id of unique) if (!ID_RE.test(id)) throw new HttpError(400, "Invalid image id");
  if (!unique.length) return;
  const rows = await env.DB.prepare(`SELECT id FROM images WHERE id IN (${unique.map(() => "?").join(",")})`)
    .bind(...unique)
    .all<{ id: string }>();
  if (rows.results.length !== unique.length) throw new HttpError(400, "Unknown image id — upload it first");
}

export const uploadImage: Handler = async ({ req, env }) => {
  const gameSet = await requireGameSet(req, env);
  const len = Number(req.headers.get("content-length") || 0);
  if (len > MAX_IMAGE_BYTES) throw new HttpError(413, "Image is too large (max 1.5 MB after compression)");
  const id = await storeImage(env, gameSet, new Uint8Array(await req.arrayBuffer()));
  return json({ id, url: imageUrl(id) });
};

export const getImage: Handler = async ({ req, env, params }) => {
  const id = params.id;
  if (!ID_RE.test(id)) throw new HttpError(404, "Not found");
  if (req.headers.get("if-none-match") === `"${id}"`) {
    return new Response(null, { status: 304, headers: { etag: `"${id}"` } });
  }
  const row = await env.DB.prepare("SELECT mime, bytes FROM images WHERE id = ?").bind(id).first<{ mime: string; bytes: ArrayBuffer | number[] }>();
  if (!row) throw new HttpError(404, "Not found");
  const body = row.bytes instanceof ArrayBuffer ? row.bytes : new Uint8Array(row.bytes);
  return new Response(body, {
    headers: {
      "content-type": row.mime,
      "cache-control": "public, max-age=31536000, immutable",
      etag: `"${id}"`,
      "x-content-type-options": "nosniff",
    },
  });
};
