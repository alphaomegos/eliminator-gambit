import { Env, HttpError, json, now, readJson, str, type Handler } from "./http";

export const NAME_RE = /^[A-Z0-9_-]{4,16}$/;
const PIN_MIN = 4;
const PIN_MAX = 32;
const SESSION_TTL_MS = 180 * 24 * 3600 * 1000;
const MAX_FAILED = 10;
const LOCK_MS = 15 * 60 * 1000;
// Workers free plan has a tight CPU budget; the lockout above is the main brute-force defence.
const PBKDF2_ITERATIONS = 20_000;

const enc = new TextEncoder();

function b64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function unb64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}
export async function sha256Hex(data: string | ArrayBuffer | Uint8Array): Promise<string> {
  const buf = typeof data === "string" ? enc.encode(data) : data;
  const h = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function pbkdf2(pin: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

export async function hashPin(pin: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(pin, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${b64(salt)}$${b64(hash)}`;
}

export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const [algo, iter, salt, hash] = stored.split("$");
  if (algo !== "pbkdf2") return false;
  const got = await pbkdf2(pin, unb64(salt), Number(iter));
  const want = unb64(hash);
  if (got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got[i] ^ want[i];
  return diff === 0;
}

export function normalizeName(raw: unknown): string {
  const name = String(raw ?? "").trim().toUpperCase();
  if (!NAME_RE.test(name)) {
    throw new HttpError(400, "Game set name must be 4–16 characters: letters, digits, - or _");
  }
  return name;
}

function readPin(raw: unknown): string {
  const pin = str(raw, "PIN", { min: PIN_MIN, max: PIN_MAX });
  if (pin.length < PIN_MIN) throw new HttpError(400, `PIN must be at least ${PIN_MIN} characters`);
  return pin;
}

async function issueSession(env: Env, gameSet: string): Promise<string> {
  const token = b64(crypto.getRandomValues(new Uint8Array(32))).replace(/[+/=]/g, (c) =>
    c === "+" ? "-" : c === "/" ? "_" : "",
  );
  const t = now();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(t),
    env.DB.prepare("INSERT INTO sessions (token_hash, game_set, created_at, expires_at) VALUES (?, ?, ?, ?)").bind(
      await sha256Hex(token),
      gameSet,
      t,
      t + SESSION_TTL_MS,
    ),
  ]);
  return token;
}

/** Resolves the Bearer token to a game set name or throws 401. */
export async function requireGameSet(req: Request, env: Env): Promise<string> {
  const auth = req.headers.get("authorization") || "";
  const m = /^Bearer\s+(\S+)$/i.exec(auth);
  if (!m) throw new HttpError(401, "Not logged in");
  const row = await env.DB.prepare("SELECT game_set, expires_at FROM sessions WHERE token_hash = ?")
    .bind(await sha256Hex(m[1]))
    .first<{ game_set: string; expires_at: number }>();
  if (!row || row.expires_at < now()) throw new HttpError(401, "Session expired, please log in again");
  return row.game_set;
}

// ---------- handlers ----------

export const gameSetStatus: Handler = async ({ env, params }) => {
  const name = normalizeName(params.name);
  const row = await env.DB.prepare("SELECT pin_hash FROM game_sets WHERE name = ?").bind(name).first<{ pin_hash: string | null }>();
  return json({ name, exists: !!row, has_pin: !!row?.pin_hash });
};

export const login: Handler = async ({ req, env }) => {
  const body = await readJson<{ name?: unknown; pin?: unknown; create?: unknown }>(req, 4096);
  const name = normalizeName(body.name);
  const pin = readPin(body.pin);
  const t = now();

  const row = await env.DB.prepare("SELECT pin_hash, failed_attempts, locked_until FROM game_sets WHERE name = ?")
    .bind(name)
    .first<{ pin_hash: string | null; failed_attempts: number; locked_until: number | null }>();

  if (!row) {
    if (body.create !== true) throw new HttpError(404, "Game set not found");
    const res = await env.DB.prepare("INSERT OR IGNORE INTO game_sets (name, pin_hash, created_at) VALUES (?, ?, ?)")
      .bind(name, await hashPin(pin), t)
      .run();
    if (!res.meta.changes) throw new HttpError(409, "Game set was just created by someone else");
    return json({ token: await issueSession(env, name), game_set: name, created: true });
  }

  if (row.locked_until && row.locked_until > t) {
    const mins = Math.ceil((row.locked_until - t) / 60000);
    throw new HttpError(429, `Too many wrong PINs. Try again in ${mins} min.`);
  }

  if (!row.pin_hash) {
    // Legacy game set without a PIN: the first login claims it.
    await env.DB.prepare("UPDATE game_sets SET pin_hash = ? WHERE name = ? AND pin_hash IS NULL")
      .bind(await hashPin(pin), name)
      .run();
  } else if (!(await verifyPin(pin, row.pin_hash))) {
    const failed = row.failed_attempts + 1;
    const lock = failed >= MAX_FAILED;
    await env.DB.prepare("UPDATE game_sets SET failed_attempts = ?, locked_until = ? WHERE name = ?")
      .bind(lock ? 0 : failed, lock ? t + LOCK_MS : null, name)
      .run();
    throw new HttpError(401, "Wrong PIN");
  } else if (row.failed_attempts) {
    await env.DB.prepare("UPDATE game_sets SET failed_attempts = 0, locked_until = NULL WHERE name = ?").bind(name).run();
  }

  return json({ token: await issueSession(env, name), game_set: name, created: false });
};

export const logout: Handler = async ({ req, env }) => {
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") || "");
  if (m) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256Hex(m[1])).run();
  return json({ ok: true });
};

export const changePin: Handler = async ({ req, env }) => {
  const gameSet = await requireGameSet(req, env);
  const body = await readJson<{ current_pin?: unknown; new_pin?: unknown }>(req, 4096);
  const current = readPin(body.current_pin);
  const next = readPin(body.new_pin);
  const row = await env.DB.prepare("SELECT pin_hash FROM game_sets WHERE name = ?").bind(gameSet).first<{ pin_hash: string }>();
  if (!row?.pin_hash || !(await verifyPin(current, row.pin_hash))) throw new HttpError(401, "Wrong current PIN");
  await env.DB.batch([
    env.DB.prepare("UPDATE game_sets SET pin_hash = ? WHERE name = ?").bind(await hashPin(next), gameSet),
    env.DB.prepare("DELETE FROM sessions WHERE game_set = ?").bind(gameSet),
  ]);
  return json({ token: await issueSession(env, gameSet) });
};
