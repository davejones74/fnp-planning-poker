import type { ClientMessage } from "../../../shared/types.ts";

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

export function openSocket(url: string): WebSocket {
  return new WebSocket(url);
}