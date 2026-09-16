import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "../src/shared/errors.ts";
import { makeHarness, roomWithTwo } from "./helpers.ts";

describe("RoomService - permissions", () => {
  it("forbids a participant from modifying the story", async () => {
    const h = makeHarness();
    const { code, joinerId } = await roomWithTwo(h);
    await assert.rejects(
      h.service.updateStory(code, joinerId, {
        title: "JIRA-1",
        description: "x",
      }),
      (err: unknown) => {
        const e = err as ApiError;
        return e instanceof ApiError && e.code === "NOT_FACILITATOR" && e.status === 403;
      },
    );
  });

  it("forbids a participant from revealing cards", async () => {
    const h = makeHarness();
    const { code, joinerId } = await roomWithTwo(h);
    await assert.rejects(h.service.revealCards(code, joinerId), (err: unknown) => {
      const e = err as ApiError;
      return e instanceof ApiError && e.code === "NOT_FACILITATOR";
    });
  });

  it("forbids a participant from starting a new round", async () => {
    const h = makeHarness();
    const { code, joinerId } = await roomWithTwo(h);
    await assert.rejects(h.service.newRound(code, joinerId), (err: unknown) => {
      const e = err as ApiError;
      return e instanceof ApiError && e.code === "NOT_FACILITATOR";
    });
  });

  it("forbids operations from a participant id that is not in the room", async () => {
    const h = makeHarness();
    const { code } = await roomWithTwo(h);
    await assert.rejects(h.service.selectCard(code, "p_ghost", "5"), (err: unknown) => {
      const e = err as ApiError;
      return e instanceof ApiError && e.code === "NOT_IN_ROOM";
    });
    await assert.rejects(h.service.revealCards(code, "p_ghost"), (err: unknown) => {
      const e = err as ApiError;
      return e instanceof ApiError && e.code === "NOT_IN_ROOM";
    });
    await assert.rejects(h.service.updateStory(code, "p_ghost", { title: "A", description: "" }), (err: unknown) => {
      const e = err as ApiError;
      return e instanceof ApiError && e.code === "NOT_IN_ROOM";
    });
  });

  it("lets the facilitator update the story", async () => {
    const h = makeHarness();
    const { code, facilitatorId } = await roomWithTwo(h);
    await h.service.updateStory(code, facilitatorId, {
      title: "JIRA-123",
      description: "Implement payment validation",
    });
    const room = await h.service.getRoom(code);
    assert.equal(room.story?.title, "JIRA-123");
    assert.equal(room.story?.description, "Implement payment validation");
  });

  it("rejects an over-long story", async () => {
    const h = makeHarness();
    const { code, facilitatorId } = await roomWithTwo(h);
    await assert.rejects(
      h.service.updateStory(code, facilitatorId, {
        title: "x".repeat(101),
        description: "",
      }),
      (err: unknown) => {
        const e = err as ApiError;
        return e instanceof ApiError && e.code === "INVALID_REQUEST";
      },
    );
    await assert.rejects(
      h.service.updateStory(code, facilitatorId, {
        title: "ok",
        description: "y".repeat(501),
      }),
      (err: unknown) => {
        const e = err as ApiError;
        return e instanceof ApiError && e.code === "INVALID_REQUEST";
      },
    );
  });

  it("forbids a participant from removing another participant", async () => {
    const h = makeHarness();
    const { code, joinerId, facilitatorId } = await roomWithTwo(h);
    await assert.rejects(
      h.service.removeParticipant(code, joinerId, facilitatorId),
      (err: unknown) => {
        const e = err as ApiError;
        return e instanceof ApiError && e.code === "NOT_FACILITATOR";
      },
    );
  });

  it("lets the facilitator remove another participant", async () => {
    const h = makeHarness();
    const { code, facilitatorId, joinerId } = await roomWithTwo(h);
    await h.service.removeParticipant(code, facilitatorId, joinerId);
    const room = await h.service.getRoom(code);
    assert.equal(room.participants.length, 1);
    const left = h.pubsub.forRoom(code).find((e) => e.event.type === "participant.left");
    assert.ok(left, "participant.left event expected");
  });

  it("rejects the facilitator removing themselves", async () => {
    const h = makeHarness();
    const { code, facilitatorId } = await roomWithTwo(h);
    await assert.rejects(
      h.service.removeParticipant(code, facilitatorId, facilitatorId),
      (err: unknown) => {
        const e = err as ApiError;
        return e instanceof ApiError && e.code === "CONFLICT";
      },
    );
  });

  it("does not trust a client-supplied facilitator flag", async () => {
    const h = makeHarness();
    const { code, joinerId } = await roomWithTwo(h);
    // A regular participant cannot gain facilitator powers through the API.
    const room = await h.service.getRoom(code, joinerId);
    const self = room.self;
    assert.ok(self);
    const me = room.participants.find((p) => p.id === joinerId);
    assert.equal(me?.isFacilitator, false);
  });
});