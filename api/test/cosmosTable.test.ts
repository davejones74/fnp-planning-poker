import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Participant, Room } from "../../shared/types.ts";
import {
  fromEntity,
  toEntity,
} from "../src/services/CosmosTableRoomRepository.ts";
import { makeHarness, roomWithTwo } from "./helpers.ts";

describe("CosmosTableRoomRepository - entity mapping", () => {
  it("round-trips a fresh room through the entity form", async () => {
    const h = makeHarness();
    const { room } = await h.service.createRoom("Dave");

    const entity = toEntity(room);
    assert.equal(entity.partitionKey, "rooms");
    assert.equal(entity.rowKey, room.code);
    assert.equal(entity.code, room.code);

    const restored = fromEntity(entity);
    assert.deepEqual(restored, room);
  });

  it("round-trips participants, deck and round state", async () => {
    const h = makeHarness();
    const { code, joinerId } = await roomWithTwo(h);
    const room = await h.repository.get(code) as Room;
    const participant = room.participants.get(joinerId) as Participant;
    participant.selectedCard = room.deck[0];

    const restored = fromEntity(toEntity(room));
    assert.equal(restored.participants.size, 2);
    assert.equal(restored.participants.get(joinerId)?.selectedCard, room.deck[0]);
    assert.equal(restored.currentRound.status, "voting");
    assert.deepEqual([...restored.deck], room.deck);
    assert.equal(restored.facilitatorId, room.facilitatorId);
  });

  it("stores the optional jira feed url when set", async () => {
    const h = makeHarness();
    const { room, participant } = await h.service.createRoom("Dave");
    await h.service.setJiraFeedUrl(
      room.code,
      participant.id,
      "https://jira.invalid/filter/123",
    );

    const restored = fromEntity(toEntity(room));
    assert.equal(restored.jiraFeedUrl, "https://jira.invalid/filter/123");
  });

  it("omits the jira feed url when absent", async () => {
    const h = makeHarness();
    const { room } = await h.service.createRoom("Dave");
    const restored = fromEntity(toEntity(room));
    assert.equal(restored.jiraFeedUrl, undefined);
  });
});