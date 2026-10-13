import { exports as workerExports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

const BASE = "https://app.test";
const worker = (workerExports as unknown as { default: Fetcher }).default;
let token = "";

async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const init: RequestInit = { method, headers: { ...headers } };
  if (token) (init.headers as Record<string, string>).authorization = `Bearer ${token}`;
  if (body instanceof Uint8Array) {
    init.body = body;
  } else if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)["content-type"] = "application/json";
  }
  const res = await worker.fetch(new Request(BASE + path, init));
  const ct = res.headers.get("content-type") || "";
  return { status: res.status, data: ct.includes("json") ? ((await res.json()) as any) : null, res };
}

async function login(name = "PARTY1", pin = "1234") {
  token = "";
  const r = await call("POST", "/api/auth/login", { name, pin, create: true });
  token = r.data.token;
  return r;
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

const manualTemplate = (overrides: Record<string, unknown> = {}) => ({
  kind: "manual",
  name: "Capitals",
  prompt: "Find the city that is not a capital",
  items: [
    { title: "Paris", secret_text: "France" },
    { title: "Berlin", secret_text: "Germany" },
    { title: "Sydney", secret_text: "Not a capital", is_target: true },
  ],
  ...overrides,
});

beforeEach(() => {
  token = "";
});

describe("auth", () => {
  it("creates a game set, then requires the right PIN", async () => {
    expect((await call("GET", "/api/game-sets/party1")).data).toMatchObject({ exists: false });
    const created = await login();
    expect(created.status).toBe(200);
    expect(created.data.created).toBe(true);
    expect((await call("GET", "/api/game-sets/PARTY1")).data).toMatchObject({ exists: true, has_pin: true });

    token = "";
    expect((await call("POST", "/api/auth/login", { name: "PARTY1", pin: "0000" })).status).toBe(401);
    expect((await call("POST", "/api/auth/login", { name: "PARTY1", pin: "1234" })).status).toBe(200);
    expect((await call("POST", "/api/auth/login", { name: "NOPE00", pin: "1234" })).status).toBe(404);
  });

  it("locks the game set after too many wrong PINs", async () => {
    await login("LOCKME");
    token = "";
    for (let i = 0; i < 10; i++) await call("POST", "/api/auth/login", { name: "LOCKME", pin: "9999" });
    expect((await call("POST", "/api/auth/login", { name: "LOCKME", pin: "1234" })).status).toBe(429);
  });

  it("rejects API calls without a session", async () => {
    expect((await call("GET", "/api/templates")).status).toBe(401);
  });

  it("isolates game sets from each other", async () => {
    await login("SETAAA");
    const tpl = await call("POST", "/api/templates", manualTemplate());
    await login("SETBBB");
    expect((await call("GET", `/api/templates/${tpl.data.id}`)).status).toBe(404);
    expect((await call("GET", "/api/templates")).data.templates).toEqual([]);
  });

  it("blocks cross-origin writes", async () => {
    const r = await call("POST", "/api/auth/login", { name: "XXXXXX", pin: "1234", create: true }, { origin: "https://evil.example" });
    expect(r.status).toBe(403);
  });
});

describe("templates & images", () => {
  it("CRUD with item order preserved and validation", async () => {
    await login();
    const created = await call("POST", "/api/templates", manualTemplate());
    expect(created.status).toBe(201);
    expect(created.data.items.map((i: any) => i.title)).toEqual(["Paris", "Berlin", "Sydney"]);

    const bad = await call("POST", "/api/templates", manualTemplate({ items: [{ title: "only one", secret_text: "x" }] }));
    expect(bad.status).toBe(400);

    const upd = await call("PUT", `/api/templates/${created.data.id}`, manualTemplate({ name: "Renamed" }));
    expect(upd.data.name).toBe("Renamed");
    expect((await call("GET", "/api/templates")).data.templates).toHaveLength(1);
    expect((await call("DELETE", `/api/templates/${created.data.id}`)).status).toBe(200);
    expect((await call("GET", "/api/templates")).data.templates).toHaveLength(0);
  });

  it("uploads and serves images; rejects non-images", async () => {
    await login();
    const up = await call("POST", "/api/images", PNG, { "content-type": "image/png" });
    expect(up.status).toBe(200);
    const img = await call("GET", up.data.url);
    expect(img.status).toBe(200);
    expect(img.res.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await img.res.arrayBuffer())).toEqual(PNG);

    expect((await call("POST", "/api/images", new Uint8Array([1, 2, 3]))).status).toBe(415);
    const missing = await call("POST", "/api/templates", manualTemplate({ image_id: "a".repeat(64) }));
    expect(missing.status).toBe(400);
  });
});

describe("matches", () => {
  it("plays a full match with server-side scoring and resume", async () => {
    await login();
    const tpl = (await call("POST", "/api/templates", manualTemplate())).data;
    const start = await call("POST", "/api/matches", { team1: "Cats", team2: "Dogs", plan: [`template:${tpl.id}`, "builtin:movies"] });
    expect(start.status).toBe(201);
    let m = start.data;
    expect(m.total_rounds).toBe(2);
    expect(m.round.items).toHaveLength(3);
    // Secrets are hidden during play
    expect(m.round.items.every((i: any) => i.secret_text === null && i.is_target === null)).toBe(true);

    // Resume after "reload"
    expect((await call("GET", "/api/matches/current")).data.match.id).toBe(m.id);

    // Team 1 eliminates a safe item
    const safe = m.round.items.find((i: any) => i.title !== "Sydney");
    m = (await call("POST", `/api/matches/${m.id}/eliminate`, { item_id: safe.id })).data;
    expect(m.event.kind).toBe("safe");
    expect(m.score1).toBe(1);
    expect(m.round.current_team).toBe(2);
    expect(m.round.items.find((i: any) => i.id === safe.id).secret_text).toBeTruthy();

    // Same item again → 409
    expect((await call("POST", `/api/matches/${m.id}/eliminate`, { item_id: safe.id })).status).toBe(409);

    // Team 2 hits the target
    const target = m.round.items.find((i: any) => i.title === "Sydney");
    m = (await call("POST", `/api/matches/${m.id}/eliminate`, { item_id: target.id })).data;
    expect(m.event.kind).toBe("hit_target");
    expect(m.score2).toBe(-4);
    expect(m.round.status).toBe("finished");
    expect(m.round.winner_team).toBe(1);
    expect(m.round.items.find((i: any) => i.id === target.id).is_target).toBe(true);
    expect(m.has_next).toBe(true);

    // Next round: built-in movies, 11 items, target is lowest rating
    m = (await call("POST", `/api/matches/${m.id}/next`)).data;
    expect(m.round_index).toBe(1);
    expect(m.round.items).toHaveLength(11);
    // Double "next" is rejected because the new round is still active
    expect((await call("POST", `/api/matches/${m.id}/next`)).status).toBe(409);

    // Eliminate everything except Battlefield Earth (the lowest) → cleared, match finished
    const items = m.round.items.filter((i: any) => !i.title.startsWith("Battlefield"));
    for (const it of items) m = (await call("POST", `/api/matches/${m.id}/eliminate`, { item_id: it.id })).data;
    expect(m.event.kind).toBe("cleared");
    expect(m.round.winner_team).toBeNull();
    expect(m.status).toBe("finished");
    expect(m.score1 + m.score2).toBe(1 - 4 + 10);
    expect((await call("GET", "/api/matches/current")).data.match).toBeNull();
  });

  it("undoes eliminations, restoring scores, turn and finished rounds", async () => {
    await login("UNDO01");
    const tpl = (await call("POST", "/api/templates", manualTemplate())).data;
    let m = (await call("POST", "/api/matches", { plan: [`template:${tpl.id}`] })).data;
    expect(m.last_elimination).toBeNull();
    expect((await call("POST", `/api/matches/${m.id}/undo`)).status).toBe(409);

    const paris = m.round.items.find((i: any) => i.title === "Paris");
    const sydney = m.round.items.find((i: any) => i.title === "Sydney");
    m = (await call("POST", `/api/matches/${m.id}/eliminate`, { item_id: paris.id })).data; // team 1 +1
    expect(m.last_elimination).toMatchObject({ item_id: paris.id, team: 1 });
    m = (await call("POST", `/api/matches/${m.id}/eliminate`, { item_id: sydney.id })).data; // team 2 −4, match over
    expect(m.status).toBe("finished");
    expect([m.score1, m.score2]).toEqual([1, -4]);

    // Undo the target hit: round and match reopen, team 2 to move again
    m = (await call("POST", `/api/matches/${m.id}/undo`)).data;
    expect(m.event).toMatchObject({ kind: "undo", item_id: sydney.id, team: 2, points: 4 });
    expect(m.status).toBe("active");
    expect(m.round.status).toBe("active");
    expect(m.round.current_team).toBe(2);
    expect(m.round.winner_team).toBeNull();
    expect([m.score1, m.score2]).toEqual([1, 0]);
    expect(m.round.items.find((i: any) => i.id === sydney.id)).toMatchObject({ eliminated: false, secret_text: null, is_target: null });

    // Undo the safe pick too
    m = (await call("POST", `/api/matches/${m.id}/undo`)).data;
    expect([m.score1, m.score2]).toEqual([0, 0]);
    expect(m.round.current_team).toBe(1);
    expect(m.last_elimination).toBeNull();

    // Play continues normally after undo
    m = (await call("POST", `/api/matches/${m.id}/eliminate`, { item_id: sydney.id })).data;
    expect(m.event.kind).toBe("hit_target");
    expect(m.score1).toBe(-4);

    // A finished match replaced by a newer one can't be reopened
    await call("POST", "/api/matches", { plan: ["builtin:movies"] });
    expect((await call("POST", `/api/matches/${m.id}/undo`)).status).toBe(409);
  });

  it("rejects bad plans", async () => {
    await login();
    expect((await call("POST", "/api/matches", { plan: [] })).status).toBe(400);
    expect((await call("POST", "/api/matches", { plan: ["builtin:nope"] })).status).toBe(400);
    expect((await call("POST", "/api/matches", { plan: [`template:${crypto.randomUUID()}`] })).status).toBe(400);
    expect((await call("POST", "/api/matches", { plan: Array(11).fill("builtin:movies") })).status).toBe(400);
  });
});

describe("static", () => {
  it("serves the SPA and keeps unknown API paths as JSON 404", async () => {
    const page = await worker.fetch(new Request(BASE + "/"));
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Eliminator");
    const api = await call("GET", "/api/does-not-exist");
    expect(api.status).toBe(404);
    expect(api.data.detail).toBe("Not found");
  });
});
