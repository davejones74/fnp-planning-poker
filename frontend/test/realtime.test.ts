import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parsePubSubEnvelope } from "../src/realtime/websocket.ts";

describe("parsePubSubEnvelope", () => {
  it("extracts the payload from a group message envelope", () => {
    const envelope = JSON.stringify({
      type: "message",
      from: "group",
      group: "ABC123",
      dataType: "json",
      data: { type: "round.started", roomCode: "ABC123", roundId: "r1", deck: [] },
    });
    const payload = parsePubSubEnvelope(envelope);
    assert.deepEqual(payload, {
      type: "round.started",
      roomCode: "ABC123",
      roundId: "r1",
      deck: [],
    });
  });

  it("returns null for a system connected message", () => {
    assert.equal(
      parsePubSubEnvelope(
        JSON.stringify({ type: "system", event: "connected", userId: "u", connectionId: "c" }),
      ),
      null,
    );
  });

  it("returns null for malformed frames", () => {
    assert.equal(parsePubSubEnvelope("not json"), null);
    assert.equal(parsePubSubEnvelope('{"type":"pong"}'), null);
  });
});