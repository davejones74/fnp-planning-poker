import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ROOM_CODE_ALPHABET } from "../../shared/validation.ts";
import { ApiError } from "../src/shared/errors.ts";
import { makeHarness, roomWithTwo } from "./helpers.ts";

describe("RoomService - create room", () => {
  it("creates a room with a valid 6-character code from the safe alphabet", async () => {
    const h = makeHarness();
    const { room, participant } = await h.service.createRoom("Dave");
    assert.equal(room.code.length, 6);
    for (const ch of room.code) {
      assert.ok(ROOM_CODE_ALPHABET.includes(ch), `code contains ${ch}`);
    }
    assert.equal(room.participants.size, 1);
    assert.equal(room.currentRound.status, "voting");
    assert.equal(room.deck.length, 11);
  });

  it("makes the creator the facilitator", async () => {
    const h = makeHarness();
    const { room, participant } = await h.service.createRoom("Dave");
    assert.ok(participant.isFacilitator);
    assert.equal(room.facilitatorId, participant.id);
  });

  it("generates unique room codes across rooms", async () => {
    const h = makeHarness();
    const codes = new Set<string>();
    for (let i = 0; i < 25; i++) {
      const { room } = await h.service.createRoom(`u${i}`);
      assert.ok(!codes.has(room.code), `duplicate room code ${room.code}`);
      codes.add(room.code);
    }
  });

  it("generates unique participant ids", async () => {
    const h = makeHarness();
    const ids = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const { participant } = await h.service.createRoom(`u${i}`);
      assert.ok(!ids.has(participant.id), `duplicate participant id ${participant.id}`);
      ids.add(participant.id);
    }
  });

  it("rejects an invalid display name", async () => {
    const h = makeHarness();
    await assert.rejects(h.service.createRoom(""), (err: unknown) => {
      const e = err as ApiError;
      return e instanceof ApiError && e.code === "INVALID_REQUEST";
    });
    await assert.rejects(h.service.createRoom("x".repeat(31)), (err: unknown) => {
      const e = err as ApiError;
      return e instanceof ApiError && e.code === "INVALID_REQUEST";
    });
    await assert.rejects(h.service.createRoom(undefined), (err: unknown) => {
      const e = err as ApiError;
      return e instanceof ApiError && e.code === "INVALID_REQUEST";
    });
  });
});

describe("RoomService - join room", () => {
  it("adds a second participant who is not the facilitator", async () => {
    const h = makeHarness();
    const { code, joinerId } = await roomWithTwo(h);
    const room = await h.service.getRoom(code);
    assert.equal(room.participants.length, 2);
    const alice = room.participants.find((p) => p.id === joinerId);
    assert.ok(alice);
    assert.equal(alice.isFacilitator, false);
  });

  it("rejects joining an unknown room", async () => {
    const h = makeHarness();
    await assert.rejects(
      h.service.joinRoom("ABCDEF", "Alice"),
      (err: unknown) => {
        const e = err as ApiError;
        return e instanceof ApiError && e.code === "ROOM_NOT_FOUND" && e.status === 404;
      },
    );
  });

  it("rejects an invalid room code", async () => {
    const h = makeHarness();
    await assert.rejects(
      h.service.joinRoom("AB0DEF", "Alice"), // contains 0
      (err: unknown) => {
        const e = err as ApiError;
        return e instanceof ApiError && e.code === "INVALID_ROOM_CODE";
      },
    );
    await assert.rejects(
      h.service.joinRoom("ABC", "Alice"),
      (err: unknown) => {
        const e = err as ApiError;
        return e instanceof ApiError && e.code === "INVALID_ROOM_CODE";
      },
    );
  });

  it("rejects a blank or oversized display name on join", async () => {
    const h = makeHarness();
    const { code } = await roomWithTwo(h);
    await assert.rejects(h.service.joinRoom(code, "   "), (err: unknown) => {
      const e = err as ApiError;
      return e instanceof ApiError && e.code === "INVALID_REQUEST";
    });
    await assert.rejects(h.service.joinRoom(code, "x".repeat(31)), (err: unknown) => {
      const e = err as ApiError;
      return e instanceof ApiError && e.code === "INVALID_REQUEST";
    });
  });

  it("allows two users to join with the same display name", async () => {
    const h = makeHarness();
    const { code } = await roomWithTwo(h, "Dave", "Dave");
    const first = await h.service.getRoom(code);
    assert.equal(first.participants.length, 2);
  });

  it("returns the existing participant when rejoining with the same session id", async () => {
    const h = makeHarness();
    const { room: initial, participant } = await h.service.createRoom("Dave");
    const resumed = await h.service.joinRoom(
      initial.code,
      "Dave",
      participant.id,
    );
    assert.equal(resumed.participant.id, participant.id);
    assert.equal(resumed.participant.isFacilitator, true);
  });

  it("expires rooms after the configured lifetime", async () => {
    const h = makeHarness();
    const { code } = await roomWithTwo(h);
    h.clock.advance(25 * 3_600_000); // 25 hours
    await assert.rejects(h.service.getRoom(code), (err: unknown) => {
      const e = err as ApiError;
      return e instanceof ApiError && e.code === "ROOM_EXPIRED" && e.status === 404;
    });
    const room = await h.repository.get(code);
    assert.equal(room, undefined, "expired room should be removed from storage");
  });
});

describe("RoomService - room state", () => {
  it("does not leak card values before reveal in the public room", async () => {
    const h = makeHarness();
    const { code, joinerId } = await roomWithTwo(h);
    await h.service.selectCard(code, joinerId, "13");
    const room = await h.service.getRoom(code, joinerId);
    const alice = room.participants.find((p) => p.id === joinerId);
    assert.ok(alice);
    assert.equal(alice.hasSelected, true);
    assert.equal(alice.selectedCard, null, "card must stay hidden until reveal");
  });

  it("rejects a participant id that is not in the room", async () => {
    const h = makeHarness();
    const { code } = await roomWithTwo(h);
    await assert.rejects(
      h.service.getParticipant(code, "p_fake_not_in_room"),
      (err: unknown) => {
        const e = err as ApiError;
        return e instanceof ApiError && e.code === "NOT_IN_ROOM";
      },
    );
  });
});

describe("configuration sanity", () => {
  it("loads configuration from environment-like object", async () => {
    const { loadConfiguration } = await import("../src/config/configuration.ts");
    const config = loadConfiguration({
      ROOM_EXPIRY_HOURS: "12",
      DEFAULT_DECK: "fibonacci",
      ADMIN_USERS: " dave@x.com , alice@x.com ",
    } as NodeJS.ProcessEnv);
    assert.equal(config.roomExpiryHours, 12);
    assert.deepEqual(config.adminUsers, ["dave@x.com", "alice@x.com"]);
    assert.equal(config.defaultDeck.length, 11);
  });
});