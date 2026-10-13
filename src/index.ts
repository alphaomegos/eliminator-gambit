import { changePin, gameSetStatus, login, logout } from "./auth";
import { BUILTIN_DATASETS } from "./datasets";
import { Env, HttpError, Router, errorResponse, json, now } from "./http";
import { getImage, uploadImage } from "./images";
import { createMatch, currentMatch, endMatch, eliminateItem, getMatch, nextRound, undoElimination } from "./matches";
import { createTemplate, deleteTemplate, getTemplate, listTemplates, updateTemplate } from "./templates";

const router = new Router()
  .on("GET", "/api/health", async () => json({ status: "ok" }))
  .on("GET", "/api/builtins", async () =>
    json({ builtins: Object.entries(BUILTIN_DATASETS).map(([id, d]) => ({ id: `builtin:${id}`, name: d.name })) }),
  )
  // auth
  .on("GET", "/api/game-sets/:name", gameSetStatus)
  .on("POST", "/api/auth/login", login)
  .on("POST", "/api/auth/logout", logout)
  .on("POST", "/api/auth/pin", changePin)
  // images
  .on("POST", "/api/images", uploadImage)
  .on("GET", "/api/images/:id", getImage)
  // templates (a.k.a. "rounds" in the editor UI)
  .on("GET", "/api/templates", listTemplates)
  .on("POST", "/api/templates", createTemplate)
  .on("GET", "/api/templates/:id", getTemplate)
  .on("PUT", "/api/templates/:id", updateTemplate)
  .on("DELETE", "/api/templates/:id", deleteTemplate)
  // matches
  .on("POST", "/api/matches", createMatch)
  .on("GET", "/api/matches/current", currentMatch)
  .on("GET", "/api/matches/:id", getMatch)
  .on("POST", "/api/matches/:id/eliminate", eliminateItem)
  .on("POST", "/api/matches/:id/undo", undoElimination)
  .on("POST", "/api/matches/:id/next", nextRound)
  .on("POST", "/api/matches/:id/end", endMatch);

const SECURITY_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-frame-options": "DENY",
  "content-security-policy":
    "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; connect-src 'self' data:; frame-ancestors 'none'",
};

function withSecurityHeaders(res: Response): Response {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) if (!out.headers.has(k)) out.headers.set(k, v);
  return out;
}

async function handleApi(req: Request, env: Env, url: URL): Promise<Response> {
  // Same-origin API only: reject cross-site writes outright.
  if (req.method !== "GET" && req.method !== "HEAD") {
    const origin = req.headers.get("origin");
    if (origin && origin !== url.origin) throw new HttpError(403, "Cross-origin request blocked");
  }
  const m = router.match(req.method, url.pathname);
  if (m === null) throw new HttpError(404, "Not found");
  if (m === "method_not_allowed") throw new HttpError(405, "Method not allowed");
  return m.handler({ req, env, params: m.params, url });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/")) {
      try {
        return withSecurityHeaders(await handleApi(req, env, url));
      } catch (e) {
        return withSecurityHeaders(errorResponse(e));
      }
    }
    return withSecurityHeaders(await env.ASSETS.fetch(req));
  },

  /** Daily housekeeping (cron in wrangler.jsonc). */
  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    const t = now();
    const monthAgo = t - 30 * 24 * 3600 * 1000;
    await env.DB.batch([
      env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(t),
      env.DB.prepare("DELETE FROM matches WHERE updated_at < ?").bind(monthAgo),
      // Images no longer referenced anywhere (older than a day, so in-progress edits are safe).
      env.DB.prepare(
        `DELETE FROM images WHERE created_at < ? AND id NOT IN (
           SELECT image_id FROM templates WHERE image_id IS NOT NULL
           UNION SELECT image_id FROM template_items WHERE image_id IS NOT NULL
           UNION SELECT image_id FROM rounds WHERE image_id IS NOT NULL
           UNION SELECT image_id FROM items WHERE image_id IS NOT NULL)`,
      ).bind(t - 24 * 3600 * 1000),
    ]);
  },
} satisfies ExportedHandler<Env>;
