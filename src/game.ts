// Pure game rules — no I/O, fully unit-tested.

export type TeamId = 1 | 2;
export type RoundKind = "rated" | "manual" | "carousel";
export const ROUND_KINDS: readonly RoundKind[] = ["rated", "manual", "carousel"];

/** Points for eliminating a safe item. */
export const SAFE_PICK_POINTS = 1;
/** Points for eliminating the target (ends the round). */
export const TARGET_PICK_POINTS = -4;

export const MIN_ITEMS = 2;
export const MAX_ITEMS = 11;
export const MAX_ROUNDS_PER_MATCH = 10;

export function otherTeam(team: TeamId): TeamId {
  return team === 1 ? 2 : 1;
}

export interface RoundState {
  status: "active" | "finished";
  currentTeam: TeamId;
  targetItemId: string;
  items: { id: string; eliminated: boolean }[];
}

export type EliminationOutcome =
  /** Safe pick, round continues with the other team. */
  | { kind: "safe"; team: TeamId; points: number; nextTeam: TeamId }
  /** Safe pick and only the target is left: round ends, nobody hit it. */
  | { kind: "cleared"; team: TeamId; points: number }
  /** Picked the target: round ends, picking team loses. */
  | { kind: "hit_target"; team: TeamId; points: number; winner: TeamId; loser: TeamId };

export class GameRuleError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function eliminate(state: RoundState, itemId: string): EliminationOutcome {
  if (state.status !== "active") throw new GameRuleError("Round already finished", 409);
  const item = state.items.find((it) => it.id === itemId);
  if (!item) throw new GameRuleError("Item not found", 404);
  if (item.eliminated) throw new GameRuleError("Item already eliminated", 409);

  const team = state.currentTeam;
  if (itemId === state.targetItemId) {
    return { kind: "hit_target", team, points: TARGET_PICK_POINTS, winner: otherTeam(team), loser: team };
  }

  const remaining = state.items.filter((it) => !it.eliminated && it.id !== itemId).length;
  if (remaining <= 1) return { kind: "cleared", team, points: SAFE_PICK_POINTS };
  return { kind: "safe", team, points: SAFE_PICK_POINTS, nextTeam: otherTeam(team) };
}

/** For rated rounds the target is the lowest rating; ties go to the first one. */
export function pickRatedTarget<T extends { rating: number | null }>(items: T[]): T {
  let best: T | undefined;
  for (const it of items) {
    if (it.rating == null) continue;
    if (!best || it.rating < (best.rating as number)) best = it;
  }
  if (!best) throw new GameRuleError("Rated round has no ratings", 400);
  return best;
}

export function shuffle<T>(arr: readonly T[], rand: () => number = Math.random): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export interface TemplateItemInput {
  title: string;
  rating: number | null;
  secret_text: string | null;
  is_target: boolean;
  image_id: string | null;
}

/** Returns a list of human-readable problems; empty means valid. */
export function validateTemplateItems(kind: RoundKind, items: TemplateItemInput[]): string[] {
  const errors: string[] = [];
  if (items.length < MIN_ITEMS) errors.push(`A round needs at least ${MIN_ITEMS} items`);
  if (items.length > MAX_ITEMS) errors.push(`A round can have at most ${MAX_ITEMS} items`);
  items.forEach((it, i) => {
    if (!it.title.trim()) errors.push(`Item ${i + 1}: title is required`);
  });

  if (kind === "rated") {
    items.forEach((it, i) => {
      if (it.rating == null || !Number.isFinite(it.rating)) errors.push(`Item ${i + 1}: numeric rating is required`);
    });
    return errors;
  }

  const targets = items.filter((it) => it.is_target).length;
  if (targets !== 1) errors.push("Mark exactly one item as the target");
  items.forEach((it, i) => {
    if (!it.secret_text?.trim()) errors.push(`Item ${i + 1}: hidden info is required`);
    if (kind === "carousel" && !it.image_id) errors.push(`Item ${i + 1}: image is required for carousel rounds`);
  });
  return errors;
}

/** Points to take back when the given elimination is undone. */
export function undoPoints(itemId: string, targetItemId: string): number {
  return itemId === targetItemId ? TARGET_PICK_POINTS : SAFE_PICK_POINTS;
}
