import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  estimateRank,
  pickOutliers,
  outliersForRound,
  clearEstimateCache,
} from "../src/util/estimates.ts";
import type { CardValue, PublicParticipant } from "../../shared/types.ts";

function participant(id: string, card: CardValue | null, connected = true): PublicParticipant {
  return {
    id,
    displayName: id,
    joinedAt: "",
    isFacilitator: false,
    connected,
    hasSelected: card !== null,
    selectedCard: card,
  };
}

const R1 = "round-one";
const R2 = "round-two";

beforeEach(() => {
  clearEstimateCache();
});

describe("estimateRank", () => {
  it("ranks the fandp deck in order", () => {
    const order = ["XS", "S", "M", "L", "XL", "XXL"] as const;
    for (let i = 1; i < order.length; i++) {
      const prev = estimateRank(order[i - 1] as CardValue) as number;
      const next = estimateRank(order[i] as CardValue) as number;
      assert.ok(prev < next);
    }
    assert.equal(estimateRank("XS"), 1);
    assert.equal(estimateRank("XXL"), 6);
  });

  it("ranks the fibonacci deck numerically", () => {
    assert.equal(estimateRank("0"), 0);
    assert.equal(estimateRank("5"), 5);
    assert.equal(estimateRank("55"), 55);
    assert.ok((estimateRank("8") as number) > (estimateRank("5") as number));
  });

  it("returns null for ? and coffee", () => {
    assert.equal(estimateRank("?"), null);
    assert.equal(estimateRank("coffee"), null);
  });
});

describe("pickOutliers", () => {
  it("picks the lowest and highest rankable votes", () => {
    const members = [
      participant("a", "L"),
      participant("b", "XS"),
      participant("c", "M"),
    ];
    const pick = pickOutliers(members);
    assert.deepEqual(pick, { highestId: "a", lowestId: "b" });
  });

  it("ignores ? and coffee for the ranking", () => {
    const members = [
      participant("a", "XXL"),
      participant("b", "?"),
      participant("c", "coffee"),
      participant("d", "XS"),
      participant("e", "coffee"),
    ];
    const pick = pickOutliers(members);
    assert.deepEqual(pick, { highestId: "a", lowestId: "d" });
  });

  it("prefers online members when breaking a tie", () => {
    const expectHighestOnline = ["c", "d"] as const;
    const highestPool = expectHighestOnline.map((id) =>
      participant(id, "XXL", id === "c"),
    );
    const members = [
      ...highestPool,
      participant("a", "XS", true),
      participant("b", "M", true),
    ];
    for (let i = 0; i < 50; i++) {
      const pick = pickOutliers(members);
      assert.equal(pick?.highestId, "c");
    }
  });

  it("falls back to offline members when nobody in the tie is online", () => {
    const tieIds = ["c", "d", "e"] as const;
    const members = [
      participant("a", "M", true),
      ...tieIds.map((id) => participant(id, "XXL", false)),
    ];
    for (let i = 0; i < 200; i++) {
      const pick = pickOutliers(members);
      assert.ok(tieIds.includes(pick?.highestId as "c" | "d" | "e"));
    }
  });

  it("returns null when there is no rankable vote", () => {
    const members = [participant("a", "?"), participant("b", "coffee")];
    assert.equal(pickOutliers(members), null);
  });

  it("returns null when there is no spread", () => {
    const members = [
      participant("a", "M"),
      participant("b", "M"),
      participant("c", "M"),
    ];
    assert.equal(pickOutliers(members), null);
  });
});

describe("outliersForRound", () => {
  it("memoises the pick per round", () => {
    const members = [
      participant("a", "XXL", false),
      participant("b", "XXL", false),
      participant("c", "XS"),
    ];
    const first = outliersForRound(members, R1);
    const second = outliersForRound(members, R1);
    assert.ok(first);
    assert.equal(second, first); // same object: not re-rolled
  });

  it("may pick differently for a fresh round", () => {
    const members = [
      participant("a", "XXL", false),
      participant("b", "XXL", false),
      participant("c", "XS"),
    ];
    const r1 = outliersForRound(members, R1);
    const r2 = outliersForRound(members, R2);
    assert.ok(r1 && r2);
    assert.notEqual(r1, r2); // object identity differs per round key
    assert.ok(["a", "b"].includes(r1.highestId));
    assert.ok(["a", "b"].includes(r2.highestId));
  });
});