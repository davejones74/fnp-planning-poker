import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "../src/shared/errors.ts";
import { makeHarness, roomWithTwo } from "./helpers.ts";

describe("RoomService - voting", () => {
  it("lets a participant select a card", async () => {
    const h = makeHarness();
    const { code, joinerId } = await roomWithTwo(h);
    await h.service.selectCard(code, joinerId, "13");
    const room = await h.service.getRoom(code, joinerId);
    const alice = room.participants.find((p) => p.id === joinerId);
    assert.ok(alice);
    assert.equal(alice.hasSelected, true);
    assert.equal(alice.selectedCard, null, "card hidden before reveal");
  });

  it("lets a participant change their card before reveal", async () => {
    const h = makeHarness();
    const { code, joinerId } = await roomWithTwo(h);
    await h.service.selectCard(code, joinerId, "13");
    await h.service.selectCard(code, joinerId, "5");
    const room = await h.service.getRoom(code, joinerId);
    const alice = room.participants.find((p) => p.id === joinerId);
    assert.ok(alice && alice.hasSelected);
  });

  it("rejects an invalid card value", async () => {
    const h = makeHarness();
    const { code, joinerId } = await roomWithTwo(h);
    await assert.rejects(h.service.selectCard(code, joinerId, "99"), (err: unknown) => {
      const e = err as ApiError;
      return e instanceof ApiError && e.code === "INVALID_CARD";
    });
  });

  it("rejects a vote from someone who is not in the room", async () => {
    const h = makeHarness();
    const { code } = await roomWithTwo(h);
    await assert.rejects(h.service.selectCard(code, "p_unknown", "13"), (err: unknown) => {
      const e = err as ApiError;
      return e instanceof ApiError && e.code === "NOT_IN_ROOM";
    });
  });

  it("publishes a card.selected event without leaking the card value", async () => {
    const h = makeHarness();
    const { code, joinerId } = await roomWithTwo(h);
    await h.service.selectCard(code, joinerId, "13");
    const evt = h.pubsub.forRoom(code).find((e) => e.event.type === "card.selected");
    assert.ok(evt, "card.selected event expected");
    if (evt.event.type === "card.selected") {
      assert.equal(evt.event.participantId, joinerId);
      assert.equal(evt.event.hasSelected, true);
      assert.ok(!("card" in evt.event), "card value must not be broadcast during voting");
    }
  });

  it("does not allow voting once cards are revealed", async () => {
    const h = makeHarness();
    const { code, facilitatorId, joinerId } = await roomWithTwo(h);
    await h.service.selectCard(code, joinerId, "13");
    await h.service.revealCards(code, facilitatorId);
    await assert.rejects(h.service.selectCard(code, joinerId, "5"), (err: unknown) => {
      const e = err as ApiError;
      return e instanceof ApiError && e.code === "VOTING_CLOSED" && e.status === 409;
    });
  });

  it("forbids a participant from revealing cards", async () => {
    const h = makeHarness();
    const { code, joinerId } = await roomWithTwo(h);
    await assert.rejects(h.service.revealCards(code, joinerId), (err: unknown) => {
      const e = err as ApiError;
      return e instanceof ApiError && e.code === "NOT_FACILITATOR" && e.status === 403;
    });
  });

  it("lets the facilitator reveal cards and exposes selections", async () => {
    const h = makeHarness();
    const { code, facilitatorId, joinerId } = await roomWithTwo(h);
    await h.service.selectCard(code, joinerId, "13");
    await h.service.selectCard(code, facilitatorId, "8");
    await h.service.revealCards(code, facilitatorId);
    const room = await h.service.getRoom(code);
    assert.equal(room.roundStatus, "revealed");
    const dave = room.participants.find((p) => p.id === facilitatorId);
    const alice = room.participants.find((p) => p.id === joinerId);
    assert.ok(dave && dave.selectedCard === "8");
    assert.ok(alice && alice.selectedCard === "13");
  });

  it("reveal exposes all selections including non-selected participants", async () => {
    const h = makeHarness();
    const { code, facilitatorId } = await roomWithTwo(h);
    await h.service.selectCard(code, facilitatorId, "3");
    await h.service.revealCards(code, facilitatorId);
    const revealed = h.pubsub
      .forRoom(code)
      .find((e) => e.event.type === "cards.revealed");
    assert.ok(revealed);
    if (revealed.event.type === "cards.revealed") {
      assert.equal(revealed.event.cards.length, 1, "only the voter is listed");
      assert.equal(revealed.event.cards[0]?.card, "3");
      assert.equal(revealed.event.cards[0]?.participantId, facilitatorId);
    }
  });

  it("cannot reveal twice", async () => {
    const h = makeHarness();
    const { code, facilitatorId } = await roomWithTwo(h);
    await h.service.revealCards(code, facilitatorId);
    await assert.rejects(h.service.revealCards(code, facilitatorId), (err: unknown) => {
      const e = err as ApiError;
      return e instanceof ApiError && e.code === "VOTING_CLOSED";
    });
  });
});