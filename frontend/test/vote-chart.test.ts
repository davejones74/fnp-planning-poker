import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { voteCounts } from "../src/components/vote-chart.ts";
import type { CardValue, PublicParticipant } from "../../shared/types.ts";

function participant(id: string, card: CardValue | null): PublicParticipant {
  return {
    id,
    displayName: id,
    joinedAt: "",
    isFacilitator: false,
    connected: true,
    hasSelected: card !== null,
    selectedCard: card,
  };
}

const FANDP: CardValue[] = ["XS", "S", "M", "L", "XL", "XXL", "?", "coffee"];
const FIBONACCI: CardValue[] = ["1", "2", "3", "5", "8", "13", "21", "40", "?", "coffee"];

describe("voteCounts", () => {
  it("tallies revealed votes including ? and coffee", () => {
    const members = [
      participant("a", "M"),
      participant("b", "M"),
      participant("c", "?"),
      participant("d", "coffee"),
      participant("e", "XXL"),
      participant("f", null),
    ];
    const counts = voteCounts(members, FANDP);
    assert.deepEqual(counts, [
      { value: "M", count: 2 },
      { value: "XXL", count: 1 },
      { value: "?", count: 1 },
      { value: "coffee", count: 1 },
    ]);
  });

  it("tallies the new Fibonacci deck including 40", () => {
    const members = [
      participant("a", "40"),
      participant("b", "8"),
      participant("c", "8"),
      participant("d", "?"),
      participant("e", "coffee"),
    ];
    assert.deepEqual(voteCounts(members, FIBONACCI), [
      { value: "8", count: 2 },
      { value: "40", count: 1 },
      { value: "?", count: 1 },
      { value: "coffee", count: 1 },
    ]);
  });

  it("orders slices by the room's deck order", () => {
    const deck: CardValue[] = ["XXL", "M", "?"];
    const members = [
      participant("a", "M"),
      participant("b", "?"),
      participant("c", "XXL"),
    ];
    const counts = voteCounts(members, deck);
    assert.deepEqual(counts, [
      { value: "XXL", count: 1 },
      { value: "M", count: 1 },
      { value: "?", count: 1 },
    ]);
  });

  it("returns an empty list when nobody voted", () => {
    assert.deepEqual(voteCounts([participant("a", null)], FANDP), []);
  });
});