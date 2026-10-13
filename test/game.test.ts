import { describe, expect, it } from "vitest";
import {
  GameRuleError,
  SAFE_PICK_POINTS,
  TARGET_PICK_POINTS,
  eliminate,
  pickRatedTarget,
  shuffle,
  validateTemplateItems,
  type RoundState,
} from "../src/game";

const state = (over: Partial<RoundState> = {}): RoundState => ({
  status: "active",
  currentTeam: 1,
  targetItemId: "t",
  items: [
    { id: "a", eliminated: false },
    { id: "b", eliminated: false },
    { id: "t", eliminated: false },
  ],
  ...over,
});

describe("eliminate", () => {
  it("safe pick passes the turn", () => {
    expect(eliminate(state(), "a")).toEqual({ kind: "safe", team: 1, points: SAFE_PICK_POINTS, nextTeam: 2 });
  });

  it("hitting the target loses the round for the picking team", () => {
    expect(eliminate(state({ currentTeam: 2 }), "t")).toEqual({
      kind: "hit_target",
      team: 2,
      points: TARGET_PICK_POINTS,
      winner: 1,
      loser: 2,
    });
  });

  it("clearing everything except the target ends the round as a tie", () => {
    const s = state({ items: [{ id: "a", eliminated: true }, { id: "b", eliminated: false }, { id: "t", eliminated: false }] });
    expect(eliminate(s, "b")).toEqual({ kind: "cleared", team: 1, points: SAFE_PICK_POINTS });
  });

  it("rejects invalid moves", () => {
    expect(() => eliminate(state({ status: "finished" }), "a")).toThrow(GameRuleError);
    expect(() => eliminate(state(), "zzz")).toThrow("Item not found");
    const s = state({ items: [{ id: "a", eliminated: true }, { id: "t", eliminated: false }, { id: "b", eliminated: false }] });
    expect(() => eliminate(s, "a")).toThrow("already eliminated");
  });
});

describe("helpers", () => {
  it("pickRatedTarget takes the lowest rating", () => {
    expect(pickRatedTarget([{ rating: 3 }, { rating: 1.5 }, { rating: 2 }])).toEqual({ rating: 1.5 });
  });

  it("shuffle keeps all elements", () => {
    const a = [1, 2, 3, 4, 5, 6];
    expect(shuffle(a).sort()).toEqual(a);
  });

  it("validates templates per kind", () => {
    const base = { secret_text: null, is_target: false, image_id: null };
    expect(validateTemplateItems("rated", [{ ...base, title: "x", rating: 1 }, { ...base, title: "y", rating: 2 }])).toEqual([]);
    expect(validateTemplateItems("rated", [{ ...base, title: "x", rating: null }, { ...base, title: "y", rating: 2 }])).toHaveLength(1);
    const manual = [
      { ...base, title: "x", rating: null, secret_text: "s", is_target: true },
      { ...base, title: "y", rating: null, secret_text: "s" },
    ];
    expect(validateTemplateItems("manual", manual)).toEqual([]);
    expect(validateTemplateItems("carousel", manual).length).toBe(2); // images missing
    expect(validateTemplateItems("manual", manual.map((m) => ({ ...m, is_target: false })))).toContain(
      "Mark exactly one item as the target",
    );
  });
});
