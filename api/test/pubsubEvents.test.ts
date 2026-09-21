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
          "ce-connectionid": "conn-1",
        },
      }),
    );
    assert.equal(res.status, 200);
    const after = await rooms.getRoom(room.code);
    assert.equal(connected(after.participants, participant.id), false);
  });

  it("keeps a participant online when only one of two connections drops", async () => {
    const { room, participant } = await rooms.createRoom("Multi");
    try {
      await rooms.handleConnect(room.code, participant.id, "conn-a");
      await rooms.handleConnect(room.code, participant.id, "conn-b");
      const res = await pubsubEvents(
        new Request(URL, {
          method: "POST",
          headers: {
            "ce-type": "azure.webpubsub.sys.disconnected",
            "ce-userid": `${room.code}:${participant.id}`,
            "ce-connectionid": "conn-a",
          },
        }),
      );
      assert.equal(res.status, 200);
      const after = await rooms.getRoom(room.code);
      assert.equal(connected(after.participants, participant.id), true);
    } finally {
      // Do not leak an online participant into other tests sharing the singleton.
      await rooms.handleDisconnect(room.code, participant.id, "conn-b");
    }
  });

  it("marks a participant online from a binary connected event", async () => {
    const { room, participant } = await rooms.createRoom("Conn");
    await rooms.handleDisconnect(room.code, participant.id, "conn-1");

    const res = await pubsubEvents(
      new Request(URL, {
        method: "POST",
        headers: {
          "ce-type": "azure.webpubsub.sys.connected",
          "ce-userid": `${room.code}:${participant.id}`,
          "ce-connectionid": "conn-2",
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
          data: {
            userId: `${room.code}:${participant.id}`,
            connectionId: "conn-batch",
          },
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
