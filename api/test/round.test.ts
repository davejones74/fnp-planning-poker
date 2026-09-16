import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "../src/shared/errors.ts";
import { makeHarness, roomWithTwo } from "./helpers.ts";

describe("RoomService - new round", () => {
  it("clears all selections when a new round starts", async () => {
    const h = makeHarness();
    const { code, facilitatorId, joinerId } = await roomWithTwo(h);
    await h.service.selectCard(code, facilitatorId, "8");
    await h.service.selectCard(code, joinerId, "13");
    await h.service.revealCards(code, facilitatorId);
    await h.service.newRound(code, facilitatorId);
    const room = await h.service.getRoom(code);
    assert.equal(room.roundStatus, "voting");
    assert.equal(
      room.participants.every((p) => p.hasSelected === false),
      true,
      "selections cleared",
    );
    assert.equal(
      room.participants.every((p) => p.selectedCard === null),
      true,
      "cards hidden again",
    );
  });

  it("keeps participants in the room", async () => {
    const h = makeHarness();
    const { code, facilitatorId } = await roomWithTwo(h);
    await h.service.newRound(code, facilitatorId);
    const room = await h.service.getRoom(code);
    assert.equal(room.participants.length, 2);
  });

  it("assigns a fresh round id", async () => {
    const h = makeHarness();
    const { code, facilitatorId } = await roomWithTwo(h);
    const before = await h.service.getRoom(code);
    await h.service.newRound(code, facilitatorId);
    const after = await h.service.getRoom(code);
    assert.notEqual(after.roundId, before.roundId);
  });

  it("publishes a round.started event with the new round id", async () => {
    const h = makeHarness();
    const { code, facilitatorId } = await roomWithTwo(h);
    await h.service.newRound(code, facilitatorId);
    const evt = h.pubsub.forRoom(code).find((e) => e.event.type === "round.started");
    assert.ok(evt, "round.started event expected");
  });

  it("forbids a non-facilitator from starting a round", async () => {
    const h = makeHarness();
    const { code, joinerId } = await roomWithTwo(h);
    await assert.rejects(h.service.newRound(code, joinerId), (err: unknown) => {
      const e = err as ApiError;
      return e instanceof ApiError && e.code === "NOT_FACILITATOR";
    });
  });

  it("keeps the story across rounds", async () => {
    const h = makeHarness();
    const { code, facilitatorId } = await roomWithTwo(h);
    await h.service.updateStory(code, facilitatorId, {
      title: "JIRA-123",
      description: "Implement payment validation",
    });
    await h.service.newRound(code, facilitatorId);
    const room = await h.service.getRoom(code);
    assert.equal(room.story?.title, "JIRA-123");
  });
});