import type { ClientMessage } from "../../../shared/types.ts";

export const PUBSUB_SUBPROTOCOL = "json.webpubsub.azure.v1";

export function connectMessage(roomCode: string, participantId: string): ClientMessage {
  return { type: "connect", roomCode, participantId };
}

export function parseSocketMessage(data: string): unknown {
  try {
    return JSON.parse(data) as unknown;
  } catch {
    return null;
  }
}

export function openSocket(url: string, subprotocol?: string): WebSocket {
  return subprotocol ? new WebSocket(url, subprotocol) : new WebSocket(url);
}

/**
 * Parses a message envelope from the `json.webpubsub.azure.v1` subprotocol.
 * The service wraps every broadcast in `{ type: "message", data: ... }`; the
 * wrapped payload is what the rest of the app treats as a RoomEvent.
 */
export function parsePubSubEnvelope(data: string): unknown {
  const parsed = parseSocketMessage(data);
  if (
    typeof parsed === "object" &&
    parsed !== null &&
    (parsed as { type?: unknown }).type === "message"
  ) {
    return (parsed as { data?: unknown }).data;
  }
  return null;
}