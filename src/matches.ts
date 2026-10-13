import { requireGameSet } from "./auth";
import { BUILTIN_DATASETS } from "./datasets";
import {
  GameRuleError,
  MAX_ITEMS,
  MAX_ROUNDS_PER_MATCH,
  eliminate as applyElimination,
  pickRatedTarget,
  shuffle,
  undoPoints,
  validateTemplateItems,
  type EliminationOutcome,
  type RoundKind,
  type TeamId,
} from "./game";
import { Env, HttpError, json, newId, now, readJson, str, uuidParam, type Handler } from "./http";
import { imageUrl } from "./images";
import { loadTemplate } from "./templates";

// ---------- round sources ----------

const SOURCE_RE = /^(builtin:[a-z0-9_-]+|template:[0-9a-f-]{36})$/;

async function assertSourcesExist(env: Env, gameSet: string, plan: string[]): Promise<void> {
  const templateIds: string[] = [];
  for (const src of plan) {
    if (!SOURCE_RE.test(src)) throw new HttpError(400, `Unknown round source: ${src}`);
    const [type, id] = src.split(":");
    if (type === "builtin" && !BUILTIN_DATASETS[id]) throw new HttpError(400, `Unknown built-in round: ${id}`);
    if (type === "template") templateIds.push(id);
  }
  const unique = [...new Set(templateIds)];
  if (!unique.length) return;
  const { results } = await env.DB.prepare(
    `SELECT id FROM templates WHERE game_set = ? AND id IN (${unique.map(() => "?").join(",")})`,
  )
    .bind(gameSet, ...unique)
    .all();
  if (results.length !== unique.length) throw new HttpError(400, "Some selected rounds no longer exist");
}

interface SnapshotItem {
  title: string;
  rating: number | null;
  secret_text: string | null;
  image_id: string | null;
  is_target: boolean;
}

/** Statements that insert round `index` of a match, snapshotting its source. */
async function roundInserts(env: Env, gameSet: string, matchId: string, index: number, source: string) {
  const [type, id] = source.split(":");
  let kind: RoundKind;
  let name: string;
  let prompt: string;
  let roundImage: string | null = null;
  let items: SnapshotItem[];

  if (type === "builtin") {
    const ds = BUILTIN_DATASETS[id];
    if (!ds) throw new HttpError(400, `Unknown built-in round: ${id}`);
    kind = "rated";
    name = ds.name;
    prompt = ds.prompt;
    const picked = shuffle(ds.items).slice(0, MAX_ITEMS);
    const target = pickRatedTarget(picked);
    items = picked.map((it) => ({ ...it, secret_text: null, image_id: null, is_target: it === target }));
  } else {
    const { tpl, items: rows } = await loadTemplate(env, gameSet, id);
    kind = tpl.kind;
    name = tpl.name;
    prompt = tpl.prompt;
    roundImage = tpl.image_id;
    const parsed = rows.map((r) => ({ ...r, is_target: !!r.is_target }));
    const errors = validateTemplateItems(kind, parsed);
    if (errors.length) throw new HttpError(400, `Round "${name}" is invalid: ${errors[0]}`);
    const target = kind === "rated" ? pickRatedTarget(parsed) : parsed.find((r) => r.is_target)!;
    items = shuffle(parsed).map((r) => ({ ...r, is_target: r === target }));
  }

  const roundId = newId();
  const itemIds = items.map(() => newId());
  const targetId = itemIds[items.findIndex((i) => i.is_target)];
  const t = now();
  return [
    env.DB.prepare(
      `INSERT INTO rounds (id, match_id, round_index, kind, name, prompt, image_id, target_item_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(roundId, matchId, index, kind, name, prompt, roundImage, targetId, t),
    ...items.map((it, position) =>
      env.DB.prepare(
        `INSERT INTO items (id, round_id, position, title, rating, secret_text, image_id) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(itemIds[position], roundId, position, it.title, it.rating, it.secret_text, it.image_id),
    ),
  ];
}

// ---------- reading & serialising ----------

interface MatchRow {
  id: string;
  team1: string;
  team2: string;
  plan: string;
  round_index: number;
  score1: number;
  score2: number;
  status: "active" | "finished";
}
interface RoundRow {
  id: string;
  round_index: number;
  kind: RoundKind;
  name: string;
  prompt: string;
  image_id: string | null;
  current_team: TeamId;
  status: "active" | "finished";
  target_item_id: string;
  winner_team: TeamId | null;
  loser_team: TeamId | null;
  version: number;
}
interface ItemRow {
  id: string;
  title: string;
  rating: number | null;
  secret_text: string | null;
  image_id: string | null;
  eliminated: number;
  eliminated_by_team: TeamId | null;
  elim_order: number | null;
}

async function loadMatch(env: Env, gameSet: string, matchId: string) {
  const [m, r] = await env.DB.batch([
    env.DB.prepare("SELECT * FROM matches WHERE id = ? AND game_set = ?").bind(matchId, gameSet),
    env.DB.prepare(
      `SELECT r.* FROM rounds r JOIN matches m ON m.id = r.match_id
       WHERE r.match_id = ? AND m.game_set = ? AND r.round_index = m.round_index`,
    ).bind(matchId, gameSet),
  ]);
  const match = m.results[0] as unknown as MatchRow | undefined;
  if (!match) throw new HttpError(404, "Match not found");
  const round = r.results[0] as unknown as RoundRow | undefined;
  if (!round) throw new HttpError(500, "Match has no current round");
  const { results } = await env.DB.prepare(
    "SELECT id, title, rating, secret_text, image_id, eliminated, eliminated_by_team, elim_order FROM items WHERE round_id = ? ORDER BY position",
  )
    .bind(round.id)
    .all<ItemRow>();
  return { match, round, items: results };
}

type MatchEvent = (EliminationOutcome & { item_id: string }) | { kind: "undo"; item_id: string; team: TeamId; points: number };

function lastElimination(items: ItemRow[]): ItemRow | null {
  let last: ItemRow | null = null;
  for (const it of items) {
    if (it.eliminated && (last === null || (it.elim_order ?? 0) > (last.elim_order ?? 0))) last = it;
  }
  return last;
}

function matchOut(match: MatchRow, round: RoundRow, items: ItemRow[], event?: MatchEvent) {
  const plan = JSON.parse(match.plan) as string[];
  const finished = round.status === "finished";
  const last = lastElimination(items);
  return {
    id: match.id,
    team1: match.team1,
    team2: match.team2,
    score1: match.score1,
    score2: match.score2,
    status: match.status,
    round_index: match.round_index,
    total_rounds: plan.length,
    has_next: finished && match.round_index < plan.length - 1,
    last_elimination: last ? { item_id: last.id, title: last.title, team: last.eliminated_by_team } : null,
    round: {
      id: round.id,
      source: plan[match.round_index],
      kind: round.kind,
      name: round.name,
      prompt: round.prompt,
      image_url: imageUrl(round.image_id),
      current_team: round.current_team,
      status: round.status,
      winner_team: round.winner_team,
      loser_team: round.loser_team,
      items: items.map((it) => {
        // Hidden info is revealed only for eliminated items or once the round is over.
        const reveal = finished || !!it.eliminated;
        return {
          id: it.id,
          title: it.title,
          eliminated: !!it.eliminated,
          eliminated_by_team: it.eliminated_by_team,
          rating: reveal ? it.rating : null,
          secret_text: reveal ? it.secret_text : null,
          is_target: finished ? it.id === round.target_item_id : null,
          image_url: imageUrl(it.image_id),
        };
      }),
    },
    ...(event ? { event } : {}),
  };
}

// ---------- handlers ----------

export const createMatch: Handler = async ({ req, env }) => {
  const gameSet = await requireGameSet(req, env);
  const body = await readJson<{ team1?: unknown; team2?: unknown; plan?: unknown }>(req, 16 * 1024);
  const team1 = str(body.team1, "Team 1 name", { max: 40 }) || "Team 1";
  const team2 = str(body.team2, "Team 2 name", { max: 40 }) || "Team 2";
  const plan = body.plan;
  if (!Array.isArray(plan) || plan.length < 1 || plan.length > MAX_ROUNDS_PER_MATCH) {
    throw new HttpError(400, `Pick from 1 to ${MAX_ROUNDS_PER_MATCH} rounds`);
  }
  if (plan.some((p) => typeof p !== "string")) throw new HttpError(400, "Invalid round list");
  await assertSourcesExist(env, gameSet, plan as string[]);

  const id = newId();
  const t = now();
  await env.DB.batch([
    // Only one active match per game set: finish whatever was left open.
    env.DB.prepare("UPDATE matches SET status = 'finished', updated_at = ? WHERE game_set = ? AND status = 'active'").bind(t, gameSet),
    env.DB.prepare(
      "INSERT INTO matches (id, game_set, team1, team2, plan, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).bind(id, gameSet, team1, team2, JSON.stringify(plan), t, t),
    ...(await roundInserts(env, gameSet, id, 0, (plan as string[])[0])),
  ]);
  const { match, round, items } = await loadMatch(env, gameSet, id);
  return json(matchOut(match, round, items), { status: 201 });
};

export const currentMatch: Handler = async ({ req, env }) => {
  const gameSet = await requireGameSet(req, env);
  const row = await env.DB.prepare(
    "SELECT id FROM matches WHERE game_set = ? AND status = 'active' ORDER BY updated_at DESC LIMIT 1",
  )
    .bind(gameSet)
    .first<{ id: string }>();
  if (!row) return json({ match: null });
  const { match, round, items } = await loadMatch(env, gameSet, row.id);
  return json({ match: matchOut(match, round, items) });
};

export const getMatch: Handler = async ({ req, env, params }) => {
  const gameSet = await requireGameSet(req, env);
  const { match, round, items } = await loadMatch(env, gameSet, uuidParam(params.id, "match"));
  return json(matchOut(match, round, items));
};

export const eliminateItem: Handler = async ({ req, env, params }) => {
  const gameSet = await requireGameSet(req, env);
  const matchId = uuidParam(params.id, "match");
  const body = await readJson<{ item_id?: unknown }>(req, 4096);
  const itemId = typeof body.item_id === "string" ? body.item_id.toLowerCase() : "";

  const { match, round, items } = await loadMatch(env, gameSet, matchId);
  if (match.status !== "active") throw new HttpError(409, "This match is over");
  let outcome: EliminationOutcome;
  try {
    outcome = applyElimination(
      {
        status: round.status,
        currentTeam: round.current_team,
        targetItemId: round.target_item_id,
        items: items.map((i) => ({ id: i.id, eliminated: !!i.eliminated })),
      },
      itemId,
    );
  } catch (e) {
    if (e instanceof GameRuleError) throw new HttpError(e.status, e.message);
    throw e;
  }

  const plan = JSON.parse(match.plan) as string[];
  const roundOver = outcome.kind !== "safe";
  const matchOver = roundOver && match.round_index >= plan.length - 1;
  const t = now();
  const v = round.version;
  const scoreCol = outcome.team === 1 ? "score1" : "score2";
  const versionGuard = "(SELECT version FROM rounds WHERE id = ?) = ?";

  // D1 batches run as one transaction; the version guard makes concurrent taps safe.
  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE items SET eliminated = 1, eliminated_by_team = ?, eliminated_at = ?,
         elim_order = (SELECT COALESCE(MAX(elim_order), 0) + 1 FROM items WHERE round_id = ?)
       WHERE id = ? AND round_id = ? AND eliminated = 0 AND ${versionGuard}`,
    ).bind(outcome.team, t, round.id, itemId, round.id, round.id, v),
    env.DB.prepare(
      `UPDATE matches SET ${scoreCol} = ${scoreCol} + ?, status = ?, updated_at = ? WHERE id = ? AND ${versionGuard}`,
    ).bind(outcome.points, matchOver ? "finished" : "active", t, matchId, round.id, v),
    env.DB.prepare(
      `UPDATE rounds SET current_team = ?, status = ?, winner_team = ?, loser_team = ?, version = version + 1
       WHERE id = ? AND version = ?`,
    ).bind(
      outcome.kind === "safe" ? outcome.nextTeam : round.current_team,
      roundOver ? "finished" : "active",
      outcome.kind === "hit_target" ? outcome.winner : null,
      outcome.kind === "hit_target" ? outcome.loser : null,
      round.id,
      v,
    ),
  ]);
  if (!results[2].meta.changes) throw new HttpError(409, "The round changed meanwhile — refreshing");

  const fresh = await loadMatch(env, gameSet, matchId);
  return json(matchOut(fresh.match, fresh.round, fresh.items, { ...outcome, item_id: itemId }));
};

/** Takes back the most recent elimination of the current round (host correction). */
export const undoElimination: Handler = async ({ req, env, params }) => {
  const gameSet = await requireGameSet(req, env);
  const matchId = uuidParam(params.id, "match");
  const { match, round, items } = await loadMatch(env, gameSet, matchId);

  const last = lastElimination(items);
  if (!last || !last.eliminated_by_team) throw new HttpError(409, "Nothing to undo in this round");
  if (match.status !== "active") {
    // A match that finished on its last move can be reopened, unless it was abandoned or replaced.
    const newer = await env.DB.prepare("SELECT 1 FROM matches WHERE game_set = ? AND created_at > (SELECT created_at FROM matches WHERE id = ?) LIMIT 1")
      .bind(gameSet, matchId)
      .first();
    if (round.status !== "finished" || newer) throw new HttpError(409, "This match is over");
  }

  const team = last.eliminated_by_team;
  const points = undoPoints(last.id, round.target_item_id);
  const scoreCol = team === 1 ? "score1" : "score2";
  const t = now();
  const v = round.version;
  const versionGuard = "(SELECT version FROM rounds WHERE id = ?) = ?";

  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE items SET eliminated = 0, eliminated_by_team = NULL, eliminated_at = NULL, elim_order = NULL
       WHERE id = ? AND round_id = ? AND eliminated = 1 AND ${versionGuard}`,
    ).bind(last.id, round.id, round.id, v),
    env.DB.prepare(
      `UPDATE matches SET ${scoreCol} = ${scoreCol} - ?, status = 'active', updated_at = ? WHERE id = ? AND ${versionGuard}`,
    ).bind(points, t, matchId, round.id, v),
    env.DB.prepare(
      `UPDATE rounds SET current_team = ?, status = 'active', winner_team = NULL, loser_team = NULL, version = version + 1
       WHERE id = ? AND version = ?`,
    ).bind(team, round.id, v),
  ]);
  if (!results[2].meta.changes) throw new HttpError(409, "The round changed meanwhile — refreshing");

  const fresh = await loadMatch(env, gameSet, matchId);
  return json(matchOut(fresh.match, fresh.round, fresh.items, { kind: "undo", item_id: last.id, team, points: -points }));
};

export const nextRound: Handler = async ({ req, env, params }) => {
  const gameSet = await requireGameSet(req, env);
  const matchId = uuidParam(params.id, "match");
  const { match, round } = await loadMatch(env, gameSet, matchId);
  const plan = JSON.parse(match.plan) as string[];
  if (match.status !== "active") throw new HttpError(409, "This match is over");
  if (round.status !== "finished") throw new HttpError(409, "Finish the current round first");
  if (match.round_index >= plan.length - 1) throw new HttpError(409, "This was the last round");

  const next = match.round_index + 1;
  try {
    await env.DB.batch([
      ...(await roundInserts(env, gameSet, matchId, next, plan[next])),
      env.DB.prepare("UPDATE matches SET round_index = ?, updated_at = ? WHERE id = ? AND round_index = ?").bind(
        next,
        now(),
        matchId,
        match.round_index,
      ),
    ]);
  } catch (e) {
    // UNIQUE(match_id, round_index): another tap already advanced the match.
    if (!String((e as Error)?.message).includes("UNIQUE")) throw e;
  }
  const fresh = await loadMatch(env, gameSet, matchId);
  return json(matchOut(fresh.match, fresh.round, fresh.items));
};

export const endMatch: Handler = async ({ req, env, params }) => {
  const gameSet = await requireGameSet(req, env);
  const matchId = uuidParam(params.id, "match");
  await env.DB.prepare("UPDATE matches SET status = 'finished', updated_at = ? WHERE id = ? AND game_set = ?")
    .bind(now(), matchId, gameSet)
    .run();
  const { match, round, items } = await loadMatch(env, gameSet, matchId);
  return json(matchOut(match, round, items));
};
