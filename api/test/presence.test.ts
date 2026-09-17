import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MAX_ROOM_PARTICIPANTS } from "../../shared/validation.ts";
import { ApiError } from "../src/shared/errors.ts";
import { makeHarness } from "./helpers.ts";

describe("RoomService - connection cap", () => {
  it("rejects a new participant once the room is full", async () => {
    const h = makeHarness();
    const { room } = await h.service.createRoom("Facilitator");
    for (let i = 0; i < MAX_ROOM_PARTICIPANTS - 1; i++) {
      await h.service.joinRoom(room.code, `User ${i}`);
    }
    const full = await h.service.getRoom(room.code);
    assert.equal(full.participants.length, MAX_ROOM_PARTICIPANTS);

    await assert.rejects(h.service.joinRoom(room.code, "TooMany"), (err: unknown) => {
      const e = err as ApiError;
      return e instanceof ApiError && e.code === "ROOM_FULL" && e.status === 409;
    });
  });

  it("frees a slot when a participant is removed", async () => {
    const h = makeHarness();
    const { room, participant } = await h.service.createRoom("Facilitator");
    const joinerIds: string[] = [];
    for (let i = 0; i < MAX_ROOM_PARTICIPANTS - 1; i++) {
      const { participant: joiner } = await h.service.joinRoom(room.code, `User ${i}`);
      joinerIds.push(joiner.id);
    }
    await assert.rejects(h.service.joinRoom(room.code, "TooMany"));

    await h.service.removeParticipant(room.code, participant.id, joinerIds[0] as string);

    const { participant: replacement } = await h.service.joinRoom(room.code, "Replacement");
    assert.ok(replacement.id);
  });

  it("lets an existing participant resume even when the room is full", async () => {
    const h = makeHarness();
    const { room, participant } = await h.service.createRoom("Facilitator");
    for (let i = 0; i < MAX_ROOM_PARTICIPANTS - 1; i++) {
      await h.service.joinRoom(room.code, `User ${i}`);
    }
    const resumed = await h.service.joinRoom(room.code, "Facilitator", participant.id);
    assert.equal(resumed.participant.id, participant.id);
  });
});

describe("RoomService - presence", () => {
  it("marks a participant online again when they resume", async () => {
    const h = makeHarness();
    const { room, participant } = await h.service.createRoom("Dave");
    await h.service.handleDisconnect(room.code, participant.id);
    h.pubsub.clear();

    const resumed = await h.service.joinRoom(room.code, "Dave", participant.id);
    assert.equal(resumed.participant.connected, true);

    const updates = h.pubsub
      .forRoom(room.code)
      .filter((entry) => entry.event.type === "participant.updated");
    assert.equal(updates.length, 1);
    const event = updates[0]?.event;
    assert.equal(event?.type, "participant.updated");
    if (event?.type === "participant.updated") {
      assert.equal(event.participant.id, participant.id);
      assert.equal(event.participant.connected, true);
    }
  });

  it("does not re-announce an already connected participant", async () => {
    const h = makeHarness();
    const { room, participant } = await h.service.createRoom("Dave");
    h.pubsub.clear();
    await h.service.joinRoom(room.code, "Dave", participant.id);
    assert.equal(h.pubsub.events.length, 0);
  });

  it("closes the removed participant's connections", async () => {
    const h = makeHarness();
    const { room, participant } = await h.service.createRoom("Facilitator");
    const { participant: joiner } = await h.service.joinRoom(room.code, "Alice");
    h.pubsub.disconnects.length = 0;

    await h.service.removeParticipant(room.code, participant.id, joiner.id);

    assert.deepEqual(h.pubsub.disconnects, [
      { roomCode: room.code, participantId: joiner.id },
    ]);
  });
});
