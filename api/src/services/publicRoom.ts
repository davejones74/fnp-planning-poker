import type { PublicRoom, Room } from "../../../shared/types.ts";

/**
 * Serialises a Room for the public API without leaking card values before
 * the facilitator reveals them. Optionally includes the requesting
 * participant's own card so their UI can restore their selection.
 */
export function toPublicRoom(room: Room, viewerId?: string): PublicRoom {
  const revealed = room.currentRound.status === "revealed";
  const participants = [...room.participants.values()]
    .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt))
    .map((p) => ({
      id: p.id,
      displayName: p.displayName,
      joinedAt: p.joinedAt,
      isFacilitator: p.isFacilitator,
      connected: p.connected,
      hasSelected: p.selectedCard !== undefined,
      selectedCard: revealed ? (p.selectedCard ?? null) : null,
      ...(p.offlineAt ? { offlineAt: p.offlineAt } : {}),
    }));

  let self: PublicRoom["self"];
  if (viewerId) {
    const mine = room.participants.get(viewerId);
    if (mine) {
      self = { participantId: mine.id, selectedCard: mine.selectedCard ?? null };
    }
  }

  return {
    code: room.code,
    createdAt: room.createdAt,
    roundId: room.currentRound.id,
    roundStatus: room.currentRound.status,
    story: room.currentRound.story,
    deck: room.deck,
    participants,
    stories: room.stories.map((story) => ({ ...story })),
    ...(self ? { self } : {}),
  };
}