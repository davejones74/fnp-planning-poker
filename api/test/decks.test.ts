import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "../src/shared/errors.ts";
import { makeHarness, roomWithTwo } from "./helpers.ts";

const FIBONACCI = ["1", "2", "3", "5", "8", "13", "21", "40", "?", "coffee"];
const TSHIRT = ["XS", "S", "M", "L", "XL", "XXL", "?", "coffee"];

describe("RoomService - scoring systems", () => {
  it("defaults new rooms to the Fibonacci deck", async () => {
    const h = makeHarness();
    const { room } = await h.service.createRoom("Dave");
    assert.equal(room.deckId, "fibonacci");
    assert.deepEqual(room.deck, FIBONACCI);
  });

  it("lets the facilitator switch decks and opens a fresh round", async () => {
    const h = makeHarness();
    const { code, facilitatorId, joinerId } = await roomWithTwo(h);
    await h.service.selectCard(code, joinerId, "5");
    const before = await h.repository.get(code);
    const previousRound = before?.currentRound.id;

    const result = await h.service.switchDeck(code, facilitatorId, "fandp");
    assert.equal(result.deck.id, "fandp");
    assert.equal(result.room.deckId, "fandp");
    assert.deepEqual(result.room.deck, TSHIRT);
    assert.notEqual(result.round.id, previousRound);
    for (const participant of result.room.participants.values()) {
      assert.equal(participant.selectedCard, undefined);
    }

    const started = h.pubsub
      .forRoom(code)
      .filter((event) => event.event.type === "round.started")
      .at(-1);
    assert.ok(started);
    if (started.event.type === "round.started") {
      assert.equal(started.event.deckId, "fandp");
      assert.deepEqual(started.event.deck, TSHIRT);
    }
  });

  it("switches while revealed, clearing the previous result", async () => {
    const h = makeHarness();
    const { code, facilitatorId, joinerId } = await roomWithTwo(h);
    await h.service.selectCard(code, joinerId, "8");
    await h.service.revealCards(code, facilitatorId);

    const result = await h.service.switchDeck(code, facilitatorId, "fandp");
    assert.equal(result.round.status, "voting");
    const room = await h.service.getRoom(code);
    assert.equal(room.roundStatus, "voting");
    const alice = room.participants.find((p) => p.id === joinerId);
    assert.equal(alice?.hasSelected, false);
  });

  it("rejects a deck switch from a non-facilitator", async () => {
    const h = makeHarness();
    const { code, joinerId } = await roomWithTwo(h);
    await assert.rejects(h.service.switchDeck(code, joinerId, "fandp"), (err: unknown) => {
      const e = err as ApiError;
      return e instanceof ApiError && e.code === "NOT_FACILITATOR";
    });
  });

  it("rejects an unknown deck", async () => {
    const h = makeHarness();
    const { code, facilitatorId } = await roomWithTwo(h);
    await assert.rejects(h.service.switchDeck(code, facilitatorId, "nope"), (err: unknown) => {
      const e = err as ApiError;
      return e instanceof ApiError && e.code === "INVALID_DECK";
    });
  });
});
