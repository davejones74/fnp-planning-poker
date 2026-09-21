import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MAX_ROOM_PARTICIPANTS } from "../../shared/validation.ts";
import { ApiError } from "../src/shared/errors.ts";
import { FakeClock, makeHarness } from "./helpers.ts";

/**
 * Regression suite for the duplicate-participant / session-identity fixes:
 * explicit leave, facilitator handover, stale-offline cleanup and
 * connection-aware presence.
 */
describe("RoomService - leaving", () => {
  it("removes the leaver and closes their connections", async () => {
    const h = makeHarness();
    const { room, participant } = await h.service.createRoom("Dave");
    const { participant: alice } = await h.service.joinRoom(room.code, "Alice");
    await h.service.handleConnect(room.code, alice.id, "alice-tab");
    h.pubsub.disconnects.length = 0;

    await h.service.leaveRoom(room.code, alice.id);

    const after = await h.service.getRoom(room.code);
    assert.ok(!after.participants.some((p) => p.id === alice.id));
    assert.equal(
      after.participants.some((p) => p.id === participant.id),
      true,
    );
    assert.deepEqual(h.pubsub.disconnects, [
      { roomCode: room.code, participantId: alice.id },
    ]);
    const left = h.pubsub
      .forRoom(room.code)
      .find((entry) => entry.event.type === "participant.left");
    assert.ok(left?.event.type === "participant.left");
    if (left?.event.type === "participant.left") {
      assert.equal(left.event.participant.id, alice.id);
    }
  });

  it("rejects leaving for a participant that is not in the room", async () => {
    const h = makeHarness();
    const { room } = await h.service.createRoom("Dave");
    await assert.rejects(h.service.leaveRoom(room.code, "p_unknown"), (err: unknown) => {
      const e = err as ApiError;
      return e instanceof ApiError && e.code === "NOT_IN_ROOM" && e.status === 403;
    });
  });

  it("allows the facilitator to leave and promotes the next online participant", async () => {
    const h = makeHarness();
    const { room, participant: dave } = await h.service.createRoom("Dave");
    const { participant: beth } = await h.service.joinRoom(room.code, "Beth");
    const { participant: carol } = await h.service.joinRoom(room.code, "Carol");
    // Carol's connection drops; the next-least-recently-joined online one wins.
    await h.service.handleDisconnect(room.code, carol.id, "carol-tab");
    h.pubsub.clear();

    await h.service.leaveRoom(room.code, dave.id);

    const after = await h.service.getRoom(room.code);
    assert.ok(!after.participants.some((p) => p.id === dave.id));
    assert.equal(
      after.participants.find((p) => p.id === beth.id)?.isFacilitator,
      true,
    );
    assert.equal(
      after.participants.find((p) => p.id === carol.id)?.isFacilitator,
      false,
    );
    const promotion = h.pubsub
      .forRoom(room.code)
      .find(
        (entry) =>
          entry.event.type === "participant.updated" &&
          entry.event.participant.isFacilitator === true,
      );
    assert.ok(promotion?.event.type === "participant.updated");
    if (promotion?.event.type === "participant.updated") {
      assert.equal(promotion.event.participant.id, beth.id);
    }
  });

  it("promotes an offline participant when every joiner is offline", async () => {
    const h = makeHarness();
    const { room, participant: dave } = await h.service.createRoom("Dave");
    const { participant: beth } = await h.service.joinRoom(room.code, "Beth");
    await h.service.handleDisconnect(room.code, beth.id, "beth-tab");

    await h.service.leaveRoom(room.code, dave.id);

    const after = await h.service.getRoom(room.code);
    assert.equal(
      after.participants.find((p) => p.id === beth.id)?.isFacilitator,
      true,
    );
  });

  it("clears the facilitator when the last participant leaves", async () => {
    const h = makeHarness();
    const { room, participant: dave } = await h.service.createRoom("Dave");
    await h.service.leaveRoom(room.code, dave.id);
    const after = await h.service.getRoom(room.code);
    assert.equal(after.participants.length, 0);
  });

  it("ignores a late disconnect after the participant left", async () => {
    const h = makeHarness();
    const { room, participant } = await h.service.createRoom("Dave");
    await h.service.handleConnect(room.code, participant.id, "tab1");
    await h.service.leaveRoom(room.code, participant.id);

    // A delayed presence event for the dead participant must be a no-op.
    await h.service.handleDisconnect(room.code, participant.id, "tab1");
    const after = await h.service.getRoom(room.code);
    assert.equal(after.participants.length, 0);
  });

  it("frees a capacity slot when someone leaves", async () => {
    const h = makeHarness();
    const { room, participant } = await h.service.createRoom("Facilitator");
    const ids: string[] = [];
    for (let i = 0; i < MAX_ROOM_PARTICIPANTS - 1; i++) {
      const { participant: joiner } = await h.service.joinRoom(room.code, `User ${i}`);
      ids.push(joiner.id);
    }
    await assert.rejects(h.service.joinRoom(room.code, "TooMany"));

    await h.service.leaveRoom(room.code, ids[0] as string);

    const { participant: replacement } = await h.service.joinRoom(room.code, "Replacement");
    assert.ok(replacement.id);
    const full = await h.service.getRoom(room.code);
    assert.equal(full.participants.length, MAX_ROOM_PARTICIPANTS);
    assert.ok(full.participants.some((p) => p.id === participant.id));
  });
});

describe("RoomService - stale offline cleanup", () => {
  it("sweeps offline participants past the grace period and frees capacity", async () => {
    const clock = new FakeClock();
    const h = makeHarness(clock, { participantOfflineGraceMinutes: 60 });
    const { room, participant } = await h.service.createRoom("Dave");
    const { participant: alice } = await h.service.joinRoom(room.code, "Alice");
    await h.service.handleDisconnect(room.code, alice.id, "alice-tab");
    h.pubsub.clear();

    clock.advance(0.5 * 60 * 60 * 1000); // 30 min: inside the grace window
    let after = await h.service.getRoom(room.code);
    assert.ok(after.participants.some((p) => p.id === alice.id));

    clock.advance(31 * 60 * 1000); // 61 min total: past the window
    after = await h.service.getRoom(room.code);
    assert.ok(!after.participants.some((p) => p.id === alice.id));
    assert.ok(after.participants.some((p) => p.id === participant.id));

    const left = h.pubsub
      .forRoom(room.code)
      .find((entry) => entry.event.type === "participant.left");
    assert.ok(left?.event.type === "participant.left");
    if (left?.event.type === "participant.left") {
      assert.equal(left.event.participant.id, alice.id);
    }

    // The freed slot accepts a fresh join.
    const { participant: bob } = await h.service.joinRoom(room.code, "Bob");
    assert.ok(bob.id);
  });

  it("never sweeps an active (online) participant", async () => {
    const clock = new FakeClock();
    const h = makeHarness(clock, { participantOfflineGraceMinutes: 60 });
    const { room, participant } = await h.service.createRoom("Dave");
    const { participant: alice } = await h.service.joinRoom(room.code, "Alice");
    await h.service.handleConnect(room.code, alice.id, "alice-tab");

    clock.advance(10 * 60 * 60 * 1000); // 10 hours later, still connected
    const after = await h.service.getRoom(room.code);
    assert.ok(after.participants.some((p) => p.id === alice.id));
    assert.ok(after.participants.some((p) => p.id === participant.id));
  });

  it("never sweeps the facilitator even when offline", async () => {
    const clock = new FakeClock();
    const h = makeHarness(clock, { participantOfflineGraceMinutes: 60 });
    const { room, participant } = await h.service.createRoom("Dave");
    await h.service.handleDisconnect(room.code, participant.id, "dave-tab");

    clock.advance(10 * 60 * 60 * 1000);
    const after = await h.service.getRoom(room.code);
    assert.ok(after.participants.some((p) => p.id === participant.id));
  });

  it("resuming re-arms the stale timer", async () => {
    const clock = new FakeClock();
    const h = makeHarness(clock, { participantOfflineGraceMinutes: 60 });
    const { room } = await h.service.createRoom("Dave");
    const { participant: alice } = await h.service.joinRoom(room.code, "Alice");
    await h.service.handleDisconnect(room.code, alice.id, "alice-tab"); // lastSeen @ t0

    clock.advance(30 * 60 * 1000); // halfway to stale (t30)
    await h.service.joinRoom(room.code, "Alice", alice.id); // resume: lastSeen @ t30
    await h.service.handleDisconnect(room.code, alice.id, "alice-tab"); // drop again @ t30

    clock.advance(50 * 60 * 1000); // t80: 50 min since the resume (not 80) — kept
    const after = await h.service.getRoom(room.code);
    assert.ok(after.participants.some((p) => p.id === alice.id));

    clock.advance(20 * 60 * 1000); // t100: 70 min since the resume — swept
    const later = await h.service.getRoom(room.code);
    assert.ok(!later.participants.some((p) => p.id === alice.id));
  });
});