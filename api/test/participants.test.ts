import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MAX_ROOM_PARTICIPANTS } from "../../shared/validation.ts";
import { ApiError } from "../src/shared/errors.ts";
import { FakeClock, makeHarness } from "./helpers.ts";

/**
 * Regression suite for the duplicate-participant / session-identity fixes:
 * explicit leave, facilitator handover, a unique-name, never-pruned roster and
 * connection-aware online/offline presence.
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

describe("RoomService - presence roster", () => {
  it("keeps an offline participant on the roster and marks them offline", async () => {
    const clock = new FakeClock();
    const h = makeHarness(clock, {
      participantOfflineGraceMinutes: 60,
      roomExpiryHours: 24 * 7,
    });
    const { room, participant } = await h.service.createRoom("Dave");
    const { participant: alice } = await h.service.joinRoom(room.code, "Alice");
    await h.service.handleConnect(room.code, alice.id, "alice-tab");
    await h.service.handleDisconnect(room.code, alice.id, "alice-tab");
    h.pubsub.clear();

    clock.advance(24 * 60 * 60 * 1000); // a full day offline
    const after = await h.service.getRoom(room.code);
    assert.ok(after.participants.some((p) => p.id === alice.id));
    assert.equal(
      after.participants.find((p) => p.id === alice.id)?.connected,
      false,
    );
    assert.ok(after.participants.some((p) => p.id === participant.id));
  });

  it("flags a ghost online participant offline after the grace period but never removes them", async () => {
    const clock = new FakeClock();
    const h = makeHarness(clock, { participantOfflineGraceMinutes: 60 });
    const { room } = await h.service.createRoom("Dave");
    const { participant: alice } = await h.service.joinRoom(room.code, "Alice");
    await h.service.handleConnect(room.code, alice.id, "alice-tab"); // lastSeen @ t0
    h.pubsub.clear();

    clock.advance(10 * 60 * 60 * 1000); // the Web PubSub disconnect never arrived
    const after = await h.service.getRoom(room.code);
    assert.ok(after.participants.some((p) => p.id === alice.id));
    assert.equal(
      after.participants.find((p) => p.id === alice.id)?.connected,
      false,
    );
    const update = h.pubsub
      .forRoom(room.code)
      .find(
        (entry) =>
          entry.event.type === "participant.updated" &&
          entry.event.participant.id === alice.id &&
          entry.event.participant.connected === false,
      );
    assert.ok(update?.event.type === "participant.updated");
  });

  it("a presence heartbeat keeps a participant online", async () => {
    const clock = new FakeClock();
    const h = makeHarness(clock, { participantOfflineGraceMinutes: 60 });
    const { room } = await h.service.createRoom("Dave");
    const { participant: alice } = await h.service.joinRoom(room.code, "Alice");
    await h.service.handleConnect(room.code, alice.id, "alice-tab");

    // A live tab pings every minute; even 35-minute gaps keep lastSeenAt
    // comfortably inside the 60-minute grace window.
    for (let i = 0; i < 3; i++) {
      clock.advance(35 * 60 * 1000);
      await h.service.touchParticipant(room.code, alice.id);
    }
    const after = await h.service.getRoom(room.code);
    assert.equal(
      after.participants.find((p) => p.id === alice.id)?.connected,
      true,
    );
  });

  it("flags a participant offline once the heartbeat stops", async () => {
    const clock = new FakeClock();
    const h = makeHarness(clock, { participantOfflineGraceMinutes: 60 });
    const { room } = await h.service.createRoom("Dave");
    const { participant: alice } = await h.service.joinRoom(room.code, "Alice");
    await h.service.handleConnect(room.code, alice.id, "alice-tab");
    await h.service.touchParticipant(room.code, alice.id);

    clock.advance(61 * 60 * 1000); // tab closed; no heartbeat for over an hour
    const after = await h.service.getRoom(room.code);
    assert.ok(after.participants.some((p) => p.id === alice.id));
    assert.equal(
      after.participants.find((p) => p.id === alice.id)?.connected,
      false,
    );
  });

  it("flags the facilitator offline after the grace period without removing them", async () => {
    const clock = new FakeClock();
    const h = makeHarness(clock, { participantOfflineGraceMinutes: 60 });
    const { room, participant } = await h.service.createRoom("Dave");

    clock.advance(61 * 60 * 1000);
    const after = await h.service.getRoom(room.code);
    assert.ok(after.participants.some((p) => p.id === participant.id));
    assert.equal(
      after.participants.find((p) => p.id === participant.id)?.connected,
      false,
    );
  });

  it("a presence heartbeat revives a participant whose disconnect was missed", async () => {
    const clock = new FakeClock();
    const h = makeHarness(clock, { participantOfflineGraceMinutes: 60 });
    const { room } = await h.service.createRoom("Dave");
    const { participant: alice } = await h.service.joinRoom(room.code, "Alice");
    await h.service.handleConnect(room.code, alice.id, "alice-tab");
    h.pubsub.clear();

    h.service.handleDisconnect(room.code, alice.id, "alice-tab");
    await h.service.touchParticipant(room.code, alice.id);

    const after = await h.service.getRoom(room.code);
    assert.equal(after.participants.find((p) => p.id === alice.id)?.connected, true);
    const revived = h.pubsub
      .forRoom(room.code)
      .find(
        (entry) =>
          entry.event.type === "participant.updated" &&
          entry.event.participant.id === alice.id &&
          entry.event.participant.connected === true,
      );
    assert.ok(revived?.event.type === "participant.updated");
  });

  it("rejoining with an existing name replaces the previous participant", async () => {
    const h = makeHarness();
    const { room } = await h.service.createRoom("Dave");
    const { participant: original } = await h.service.joinRoom(room.code, "Jack");
    h.pubsub.clear();

    const { participant: replacement } = await h.service.joinRoom(room.code, "Jack");

    assert.notEqual(replacement.id, original.id);
    const after = await h.service.getRoom(room.code);
    assert.ok(!after.participants.some((p) => p.id === original.id));
    assert.ok(after.participants.some((p) => p.id === replacement.id));
    assert.equal(
      after.participants.filter((p) => p.displayName === "Jack").length,
      1,
    );
    const left = h.pubsub
      .forRoom(room.code)
      .find(
        (entry) =>
          entry.event.type === "participant.left" &&
          entry.event.participant.id === original.id,
      );
    assert.ok(left?.event.type === "participant.left");
    assert.deepEqual(h.pubsub.disconnects, [
      { roomCode: room.code, participantId: original.id },
    ]);
  });

  it("matches names case-insensitively and trimmed", async () => {
    const h = makeHarness();
    const { room } = await h.service.createRoom("Boss");
    const { participant: original } = await h.service.joinRoom(room.code, "  Alice ");
    const { participant: replacement } = await h.service.joinRoom(room.code, "alice");

    assert.notEqual(replacement.id, original.id);
    const after = await h.service.getRoom(room.code);
    assert.ok(!after.participants.some((p) => p.id === original.id));
    const aliceNames = after.participants
      .filter((p) => p.displayName.toLowerCase().trim() === "alice")
      .map((p) => p.displayName);
    assert.deepEqual(aliceNames, ["alice"]); // the latest joiner's casing wins
  });

  it("resuming a session reuses the identity without tripping name uniqueness", async () => {
    const h = makeHarness();
    const { room } = await h.service.createRoom("Dave");
    const { participant: alice } = await h.service.joinRoom(room.code, "Alice");

    const resumed = await h.service.joinRoom(room.code, "Alice", alice.id);

    assert.equal(resumed.participant.id, alice.id);
    const after = await h.service.getRoom(room.code);
    assert.ok(after.participants.some((p) => p.id === alice.id));
    assert.equal(
      after.participants.filter((p) => p.displayName === "Alice").length,
      1,
    );
  });

  it("an online facilitator is protected from name replacement", async () => {
    const h = makeHarness();
    const { room, participant: sian } = await h.service.createRoom("Sian");
    await h.service.handleConnect(room.code, sian.id, "sian-tab");

    await assert.rejects(h.service.joinRoom(room.code, "Sian"), (err: unknown) => {
      const e = err as ApiError;
      return e instanceof ApiError && e.code === "NAME_TAKEN" && e.status === 409;
    });

    const after = await h.service.getRoom(room.code);
    assert.ok(after.participants.some((p) => p.id === sian.id));
    assert.equal(
      after.participants.find((p) => p.id === sian.id)?.isFacilitator,
      true,
    );
    assert.equal(after.participants.filter((p) => p.isFacilitator).length, 1);
  });

  it("an offline facilitator's name can be reclaimed along with the role", async () => {
    const h = makeHarness();
    const { room, participant: sian } = await h.service.createRoom("Sian");
    await h.service.handleDisconnect(room.code, sian.id, "sian-tab");

    const { participant: replacement } = await h.service.joinRoom(room.code, "Sian");

    assert.notEqual(replacement.id, sian.id);
    const after = await h.service.getRoom(room.code);
    assert.equal(
      after.participants.find((p) => p.id === replacement.id)?.isFacilitator,
      true,
    );
    assert.equal(after.participants.filter((p) => p.isFacilitator).length, 1);
    assert.ok(!after.participants.some((p) => p.id === sian.id));
  });

  it("a facilitator absent past the grace period loses the name to a reclaimer", async () => {
    const clock = new FakeClock();
    const h = makeHarness(clock, { participantOfflineGraceMinutes: 60 });
    const { room, participant: sian } = await h.service.createRoom("Sian");
    await h.service.handleConnect(room.code, sian.id, "sian-tab");

    clock.advance(61 * 60 * 1000); // missed disconnect, no heartbeat
    const { participant: replacement } = await h.service.joinRoom(room.code, "Sian");

    assert.notEqual(replacement.id, sian.id);
    const after = await h.service.getRoom(room.code);
    assert.equal(
      after.participants.find((p) => p.id === replacement.id)?.isFacilitator,
      true,
    );
    assert.equal(after.participants.filter((p) => p.isFacilitator).length, 1);
    assert.ok(!after.participants.some((p) => p.id === sian.id));
  });

  it("stamps offlineAt on a real disconnect so the clock freezes there", async () => {
    const clock = new FakeClock();
    const h = makeHarness(clock, {
      participantOfflineGraceMinutes: 60,
      roomExpiryHours: 24 * 7,
    });
    const { room } = await h.service.createRoom("Dave");
    const { participant: alice } = await h.service.joinRoom(room.code, "Alice");
    await h.service.handleConnect(room.code, alice.id, "alice-tab");
    h.pubsub.clear();
    clock.advance(10 * 60 * 1000);

    await h.service.handleDisconnect(room.code, alice.id, "alice-tab");

    const after = await h.service.getRoom(room.code);
    const offline = after.participants.find((p) => p.id === alice.id);
    assert.equal(offline?.connected, false);
    assert.equal(offline?.offlineAt, "2026-01-01T00:10:00.000Z");
    const evt = h.pubsub
      .forRoom(room.code)
      .find(
        (e) =>
          e.event.type === "participant.updated" &&
          e.event.participant.id === alice.id,
      );
    assert.ok(evt?.event.type === "participant.updated");
    if (evt?.event.type === "participant.updated") {
      assert.equal(evt.event.participant.offlineAt, "2026-01-01T00:10:00.000Z");
    }
  });

  it("stamps offlineAt when the stale pass flags a ghost", async () => {
    const clock = new FakeClock();
    const h = makeHarness(clock, {
      participantOfflineGraceMinutes: 60,
      roomExpiryHours: 24 * 7,
    });
    const { room } = await h.service.createRoom("Dave");
    const { participant: alice } = await h.service.joinRoom(room.code, "Alice");
    await h.service.handleConnect(room.code, alice.id, "alice-tab");
    h.pubsub.clear();
    clock.advance(61 * 60 * 1000);

    const after = await h.service.getRoom(room.code);
    const offline = after.participants.find((p) => p.id === alice.id);
    assert.equal(offline?.connected, false);
    assert.equal(offline?.offlineAt, "2026-01-01T01:01:00.000Z");
    const evt = h.pubsub
      .forRoom(room.code)
      .find(
        (e) =>
          e.event.type === "participant.updated" &&
          e.event.participant.id === alice.id,
      );
    assert.ok(evt?.event.type === "participant.updated");
    if (evt?.event.type === "participant.updated") {
      assert.equal(evt.event.participant.offlineAt, "2026-01-01T01:01:00.000Z");
    }
  });

  it("clears offlineAt when a heartbeat revives a participant", async () => {
    const h = makeHarness();
    const { room } = await h.service.createRoom("Dave");
    const { participant: alice } = await h.service.joinRoom(room.code, "Alice");
    await h.service.handleDisconnect(room.code, alice.id, "alice-tab");

    await h.service.touchParticipant(room.code, alice.id);

    const after = await h.service.getRoom(room.code);
    const revived = after.participants.find((p) => p.id === alice.id);
    assert.equal(revived?.connected, true);
    assert.equal(revived?.offlineAt, undefined);
  });

  it("clears offlineAt when a new connection revives the participant", async () => {
    const h = makeHarness();
    const { room } = await h.service.createRoom("Dave");
    const { participant: alice } = await h.service.joinRoom(room.code, "Alice");
    await h.service.handleDisconnect(room.code, alice.id, "alice-tab");

    await h.service.handleConnect(room.code, alice.id, "new-tab");

    const after = await h.service.getRoom(room.code);
    const revived = after.participants.find((p) => p.id === alice.id);
    assert.equal(revived?.connected, true);
    assert.equal(revived?.offlineAt, undefined);
  });

  it("clears offlineAt when the session resumes", async () => {
    const h = makeHarness();
    const { room } = await h.service.createRoom("Dave");
    const { participant: alice } = await h.service.joinRoom(room.code, "Alice");
    await h.service.handleDisconnect(room.code, alice.id, "alice-tab");

    await h.service.joinRoom(room.code, "Alice", alice.id);

    const after = await h.service.getRoom(room.code);
    const revived = after.participants.find((p) => p.id === alice.id);
    assert.equal(revived?.connected, true);
    assert.equal(revived?.offlineAt, undefined);
  });

  it("flags a legacy participant with no lastSeenAt offline based on joinedAt", async () => {
    const clock = new FakeClock();
    const h = makeHarness(clock, {
      participantOfflineGraceMinutes: 60,
      roomExpiryHours: 24 * 7,
    });
    const { room } = await h.service.createRoom("Dave");
    const { participant: alice } = await h.service.joinRoom(room.code, "Alice");
    const stored = await h.repository.get(room.code);
    const storedAlice = stored?.participants.get(alice.id);
    assert.ok(storedAlice);
    delete storedAlice.lastSeenAt; // pre-migration row predates the field
    storedAlice.connected = true;

    clock.advance(24 * 60 * 60 * 1000); // a day later, still "online" on paper
    const after = await h.service.getRoom(room.code);
    assert.ok(after.participants.some((p) => p.id === alice.id));
    assert.equal(
      after.participants.find((p) => p.id === alice.id)?.connected,
      false,
    );
  });
});