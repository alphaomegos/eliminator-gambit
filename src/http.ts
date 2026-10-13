export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  if (!headers.has("cache-control")) headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function errorResponse(err: unknown): Response {
  if (err instanceof HttpError) {
    return json({ detail: err.message, ...(err.details ? { errors: err.details } : {}) }, { status: err.status });
  }
  console.error(err);
  return json({ detail: "Internal server error" }, { status: 500 });
}

export async function readJson<T = unknown>(req: Request, maxBytes = 5 * 1024 * 1024): Promise<T> {
  const len = Number(req.headers.get("content-length") || 0);
  if (len > maxBytes) throw new HttpError(413, "Request body too large");
  const text = await req.text();
  if (text.length > maxBytes) throw new HttpError(413, "Request body too large");
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
}

export type Params = Record<string, string>;
export type Handler = (ctx: { req: Request; env: Env; params: Params; url: URL }) => Promise<Response>;

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
}

/** Tiny path router: "/api/templates/:id" style patterns. */
export class Router {
  private routes: Route[] = [];

  on(method: string, path: string, handler: Handler): this {
    const keys: string[] = [];
    const src = path.replace(/:([a-zA-Z_]+)/g, (_, k: string) => {
      keys.push(k);
      return "([^/]+)";
    });
    this.routes.push({ method, pattern: new RegExp(`^${src}$`), keys, handler });
    return this;
  }

  match(method: string, pathname: string): { handler: Handler; params: Params } | "method_not_allowed" | null {
    let pathMatched = false;
    for (const r of this.routes) {
      const m = r.pattern.exec(pathname);
      if (!m) continue;
      pathMatched = true;
      if (r.method !== method) continue;
      const params: Params = {};
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      return { handler: r.handler, params };
    }
    return pathMatched ? "method_not_allowed" : null;
  }
}

// ---------- small input helpers ----------

export function str(v: unknown, field: string, { min = 0, max = 1000, optional = false } = {}): string {
  if (v == null || v === "") {
    if (optional) return "";
    if (min > 0) throw new HttpError(400, `${field} is required`);
    return "";
  }
  if (typeof v !== "string") throw new HttpError(400, `${field} must be a string`);
  const s = v.trim();
  if (s.length < min) throw new HttpError(400, `${field} is required`);
  if (s.length > max) throw new HttpError(400, `${field} is too long (max ${max})`);
  return s;
}

export function optNumber(v: unknown, field: string): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  if (!Number.isFinite(n)) throw new HttpError(400, `${field} must be a number`);
  return n;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function uuidParam(v: string, field = "id"): string {
  if (!UUID_RE.test(v)) throw new HttpError(404, `Unknown ${field}`);
  return v.toLowerCase();
}

export const now = () => Date.now();
export const newId = () => crypto.randomUUID();
