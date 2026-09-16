import type { RoomEvent } from "../../../shared/types.ts";

const EVENT_TYPES = new Set<string>([
  "participant.joined",
  "participant.left",
  "participant.updated",
  "card.selected",
  "cards.revealed",
  "round.started",
  "story.updated",
]);

export function isRoomEvent(value: unknown): value is RoomEvent {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { type?: unknown; roomCode?: unknown };
  return (
    typeof candidate.type === "string" &&
    EVENT_TYPES.has(candidate.type) &&
    typeof candidate.roomCode === "string"
  );
}