import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Room } from "../../shared/types.ts";
import {
  fromEntity,
  toEntity,
} from "../src/services/CosmosTableRoomRepository.ts";
import { makeHarness, roomWithTwo } from "./helpers.ts";

describe("CosmosTableRoomRepository - story backlog", () => {
  it("round-trips the session story backlog through the entity form", async () => {
    const h = makeHarness();
    const { code, facilitatorId, joinerId } = await roomWithTwo(h);
    await h.service.importStories(code, facilitatorId, {
      stories: [
        { key: "FPB-42", title: "Search payments", description: "Find a payment" },
        { key: "MAN-1", title: "Manual story", description: "" },
      ],
    });
    await h.service.startStoryEstimation(code, facilitatorId, "FPB-42");
    await h.service.selectCard(code, facilitatorId, "5");
    await h.service.selectCard(code, joinerId, "5");
    await h.service.revealCards(code, facilitatorId);
    await h.service.recordAgreedEstimate(code, facilitatorId, "FPB-42", "5");

    const room = await h.repository.get(code) as Room;
    const restored = fromEntity(toEntity(room));

    assert.equal(restored.stories.length, 2);
    assert.deepEqual(restored.stories, room.stories);
    const estimated = restored.stories.find((s) => s.key === "FPB-42");
    assert.equal(estimated?.status, "estimated");
    assert.equal(estimated?.agreedEstimate, "5");
    assert.ok(estimated?.estimatedAt, "estimatedAt timestamp restored");
    const manual = restored.stories.find((s) => s.key === "MAN-1");
    assert.equal(manual?.status, "ready");
  });

  it("defaults to an empty backlog when the stories column is missing", async () => {
    const h = makeHarness();
    const { room } = await h.service.createRoom("Dave");
    const entity = toEntity(room) as unknown as Record<string, unknown>;
    delete entity.stories;

    const restored = fromEntity(entity as never);
    assert.deepEqual(restored.stories, []);
  });
});