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