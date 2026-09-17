import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pubsubEvents } from "../src/functions/pubsubEvents.ts";
import { rooms } from "../src/services/index.ts";

const URL = "https://example.test/api/pubsub/events";

function connected(participants: Array<{ id: string; connected: boolean }>, id: string) {
  return participants.find((p) => p.id === id)?.connected;
}

describe("pubsubEvents upstream handler", () => {
  it("answers the CloudEvents abuse-protection OPTIONS handshake", async () => {
    const res = await pubsubEvents(new Request(URL, { method: "OPTIONS" }));
    assert.equal(res.status, 204);
    assert.equal(res.headers.get("webhook-allowed-origin"), "*");
  });

  it("marks a participant offline from a binary disconnected event", async () => {
    const { room, participant } = await rooms.createRoom("Disco");
    const res = await pubsubEvents(
      new Request(URL, {
        method: "POST",
        headers: {
          "ce-type": "azure.webpubsub.sys.disconnected",
          "ce-userid": `${room.code}:${participant.id}`,
        },
      }),
    );
    assert.equal(res.status, 200);
    const after = await rooms.getRoom(room.code);
    assert.equal(connected(after.participants, participant.id), false);
  });

  it("marks a participant online from a binary connected event", async () => {
    const { room, participant } = await rooms.createRoom("Conn");
    await rooms.handleDisconnect(room.code, participant.id);

    const res = await pubsubEvents(
      new Request(URL, {
        method: "POST",
        headers: {
          "ce-type": "azure.webpubsub.sys.connected",
          "ce-userid": `${room.code}:${participant.id}`,
        },
      }),
    );
    assert.equal(res.status, 200);
    const after = await rooms.getRoom(room.code);
    assert.equal(connected(after.participants, participant.id), true);
  });

  it("accepts the JSON batch fallback and ignores malformed user ids", async () => {
    const { room, participant } = await rooms.createRoom("Batch");
    const res = await pubsubEvents(
      new Request(URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "azure.webpubsub.sys.disconnected",
          data: { userId: `${room.code}:${participant.id}` },
        }),
      }),
    );
    assert.equal(res.status, 200);
    const after = await rooms.getRoom(room.code);
    assert.equal(connected(after.participants, participant.id), false);

    const bad = await pubsubEvents(
      new Request(URL, {
        method: "POST",
        headers: {
          "ce-type": "azure.webpubsub.sys.connected",
          "ce-userid": "garbage",
        },
      }),
    );
    assert.equal(bad.status, 200);
  });
});
