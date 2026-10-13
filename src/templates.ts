import { requireGameSet } from "./auth";
import { ROUND_KINDS, validateTemplateItems, type RoundKind, type TemplateItemInput } from "./game";
import { Env, HttpError, json, newId, now, optNumber, readJson, str, uuidParam, type Handler } from "./http";
import { assertImagesExist, imageUrl } from "./images";

interface TemplateInput {
  kind: RoundKind;
  name: string;
  prompt: string;
  image_id: string | null;
  items: TemplateItemInput[];
}

function parseTemplate(body: any): TemplateInput {
  if (!body || typeof body !== "object") throw new HttpError(400, "Invalid body");
  const kind = body.kind ?? "rated";
  if (!ROUND_KINDS.includes(kind)) throw new HttpError(400, "Unknown round type");
  if (!Array.isArray(body.items)) throw new HttpError(400, "items must be an array");

  const items: TemplateItemInput[] = body.items.map((it: any, i: number) => {
    const n = `Item ${i + 1}`;
    return {
      title: str(it?.title, `${n} title`, { max: 200, optional: true }),
      rating: kind === "rated" ? optNumber(it?.rating, `${n} rating`) : null,
      secret_text: kind === "rated" ? null : str(it?.secret_text, `${n} hidden info`, { max: 500, optional: true }) || null,
      is_target: kind === "rated" ? false : it?.is_target === true,
      image_id: typeof it?.image_id === "string" && it.image_id ? it.image_id : null,
    };
  });

  const tpl: TemplateInput = {
    kind,
    name: str(body.name, "Round name", { min: 1, max: 120 }),
    prompt: str(body.prompt, "Prompt", { min: 1, max: 300 }),
    image_id: typeof body.image_id === "string" && body.image_id ? body.image_id : null,
    items,
  };
  const errors = validateTemplateItems(kind, items);
  if (errors.length) throw new HttpError(400, errors[0], errors);
  return tpl;
}

function itemInserts(env: Env, templateId: string, items: TemplateItemInput[]) {
  return items.map((it, position) =>
    env.DB.prepare(
      `INSERT INTO template_items (id, template_id, position, title, rating, secret_text, is_target, image_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(newId(), templateId, position, it.title, it.rating, it.secret_text, it.is_target ? 1 : 0, it.image_id),
  );
}

export interface TemplateRow {
  id: string;
  kind: RoundKind;
  name: string;
  prompt: string;
  image_id: string | null;
  updated_at: number;
}
export interface TemplateItemRow {
  title: string;
  rating: number | null;
  secret_text: string | null;
  is_target: number;
  image_id: string | null;
}

export async function loadTemplate(env: Env, gameSet: string, id: string) {
  const [tplRes, itemsRes] = await env.DB.batch([
    env.DB.prepare("SELECT id, kind, name, prompt, image_id, updated_at FROM templates WHERE id = ? AND game_set = ?").bind(id, gameSet),
    env.DB.prepare(
      `SELECT ti.title, ti.rating, ti.secret_text, ti.is_target, ti.image_id
       FROM template_items ti JOIN templates t ON t.id = ti.template_id
       WHERE ti.template_id = ? AND t.game_set = ? ORDER BY ti.position`,
    ).bind(id, gameSet),
  ]);
  const tpl = tplRes.results[0] as TemplateRow | undefined;
  if (!tpl) throw new HttpError(404, "Round not found");
  return { tpl, items: itemsRes.results as unknown as TemplateItemRow[] };
}

function templateOut(tpl: TemplateRow, items: TemplateItemRow[]) {
  return {
    ...tpl,
    image_url: imageUrl(tpl.image_id),
    items: items.map((it) => ({
      title: it.title,
      rating: it.rating,
      secret_text: it.secret_text,
      is_target: !!it.is_target,
      image_id: it.image_id,
      image_url: imageUrl(it.image_id),
    })),
  };
}

export const listTemplates: Handler = async ({ req, env }) => {
  const gameSet = await requireGameSet(req, env);
  const { results } = await env.DB.prepare(
    `SELECT t.id, t.kind, t.name, t.prompt, t.image_id, t.updated_at, COUNT(i.id) AS item_count
     FROM templates t LEFT JOIN template_items i ON i.template_id = t.id
     WHERE t.game_set = ? GROUP BY t.id ORDER BY t.updated_at DESC`,
  )
    .bind(gameSet)
    .all();
  return json({ templates: results.map((r: any) => ({ ...r, image_url: imageUrl(r.image_id) })) });
};

export const getTemplate: Handler = async ({ req, env, params }) => {
  const gameSet = await requireGameSet(req, env);
  const { tpl, items } = await loadTemplate(env, gameSet, uuidParam(params.id, "round"));
  return json(templateOut(tpl, items));
};

export const createTemplate: Handler = async ({ req, env }) => {
  const gameSet = await requireGameSet(req, env);
  const body = parseTemplate(await readJson(req, 256 * 1024));
  await assertImagesExist(env, [body.image_id, ...body.items.map((i) => i.image_id)]);
  const id = newId();
  const t = now();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO templates (id, game_set, kind, name, prompt, image_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(id, gameSet, body.kind, body.name, body.prompt, body.image_id, t, t),
    ...itemInserts(env, id, body.items),
  ]);
  const { tpl, items } = await loadTemplate(env, gameSet, id);
  return json(templateOut(tpl, items), { status: 201 });
};

export const updateTemplate: Handler = async ({ req, env, params }) => {
  const gameSet = await requireGameSet(req, env);
  const id = uuidParam(params.id, "round");
  const body = parseTemplate(await readJson(req, 256 * 1024));
  await assertImagesExist(env, [body.image_id, ...body.items.map((i) => i.image_id)]);
  const owned = await env.DB.prepare("SELECT 1 FROM templates WHERE id = ? AND game_set = ?").bind(id, gameSet).first();
  if (!owned) throw new HttpError(404, "Round not found");
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE templates SET kind = ?, name = ?, prompt = ?, image_id = ?, updated_at = ? WHERE id = ? AND game_set = ?",
    ).bind(body.kind, body.name, body.prompt, body.image_id, now(), id, gameSet),
    env.DB.prepare("DELETE FROM template_items WHERE template_id = ?").bind(id),
    ...itemInserts(env, id, body.items),
  ]);
  const { tpl, items } = await loadTemplate(env, gameSet, id);
  return json(templateOut(tpl, items));
};

export const deleteTemplate: Handler = async ({ req, env, params }) => {
  const gameSet = await requireGameSet(req, env);
  const id = uuidParam(params.id, "round");
  const res = await env.DB.prepare("DELETE FROM templates WHERE id = ? AND game_set = ?").bind(id, gameSet).run();
  if (!res.meta.changes) throw new HttpError(404, "Round not found");
  return json({ deleted: true });
};
