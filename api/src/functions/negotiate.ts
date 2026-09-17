import { jsonResponse } from "../shared/http.ts";
import { ApiError } from "../shared/errors.ts";
import { configuration, rooms } from "../services/index.ts";

interface WebPubSubServiceClientLike {
  getClientAccessToken(options: {
    userId: string;
    roles: string[];
    groups: string[];
  }): Promise<{ url: string }>;
}

let clientPromise: Promise<WebPubSubServiceClientLike> | null = null;

function client(): Promise<WebPubSubServiceClientLike> {
  if (!clientPromise) {
    clientPromise = import("@azure/web-pubsub").then(
      ({ WebPubSubServiceClient }) =>
        new WebPubSubServiceClient(
          configuration.webPubSubConnectionString as string,
          configuration.webPubSubHub,
        ),
    );
  }
  return clientPromise;
}

/**
 * Negotiates the real-time endpoint. Locally this returns a same-origin
 * WebSocket URL; on Azure it returns Web PubSub credentials scoped to exactly
 * one room:
 *
 *   - `userId` = `<roomCode>:<participantId>` so presence events can be routed
 *     back to the right participant;
 *   - roles only permit joining/sending to that room's group;
 *   - the token pre-joins the room group, so the client needs no extra step.
 */
export async function negotiate(request: Request): Promise<Response> {
  if (configuration.webPubSubConnectionString) {
    const url = new URL(request.url);
    const roomCode = (url.searchParams.get("roomCode") ?? "").toUpperCase();
    const participantId = url.searchParams.get("participantId") ?? "";
    if (!roomCode || !participantId) {
      throw new ApiError(
        "INVALID_REQUEST",
        400,
        "roomCode and participantId are required to negotiate.",
      );
    }
    // Verify the participant is still in the room before minting a token, so
    // a removed (kicked) client cannot just renegotiate and reconnect.
    await rooms.getParticipant(roomCode, participantId);
    const service = await client();
    const { url: connectionUrl } = await service.getClientAccessToken({
      userId: `${roomCode}:${participantId}`,
      roles: [
        `webpubsub.joinLeaveGroup.${roomCode}`,
        `webpubsub.sendToGroup.${roomCode}`,
      ],
      groups: [roomCode],
    });
    return jsonResponse(200, {
      url: connectionUrl,
      protocol: "json.webpubsub.azure.v1",
      group: roomCode,
    });
  }

  const forwardedProto = request.headers.get("x-forwarded-proto") ?? "http";
  const scheme =
    forwardedProto.split(",")[0]?.trim().toLowerCase() === "https" ? "wss" : "ws";
  const host = request.headers.get("host") ?? "localhost:8080";
  return jsonResponse(200, {
    url: `${scheme}://${host}/ws`,
  });
}