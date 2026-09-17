import type { RoomEvent } from "../../../shared/types.ts";

/**
 * Broadcasts room events to the people in a room. Each room maps to one
 * logical group (room-{code}); events never leave the room.
 */
export interface PubSubService {
  publishToRoom(roomCode: string, event: RoomEvent): void;
  /** Force-closes a participant's sockets (used when the facilitator removes them). */
  disconnectParticipant(roomCode: string, participantId: string): void;
}