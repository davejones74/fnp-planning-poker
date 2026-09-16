import type { PublicParticipant, PublicRoom, RoomEvent } from "../../../shared/types.ts";

export interface RoomIdentity {
  participantId: string;
  displayName: string;
}

/**
 * Client-side room state fed by the room snapshot and live room events.
 * Handles merging server events so panels only re-render what changed.
 */
export class RoomState {
  room: PublicRoom;
  myCard: string | null;
  readonly identity: RoomIdentity;

  constructor(room: PublicRoom, identity: RoomIdentity) {
    this.room = room;
    this.identity = identity;
    this.myCard = room.self?.participantId === identity.participantId
      ? room.self.selectedCard
      : null;
  }

  get myParticipantId(): string {
    return this.identity.participantId;
  }

  isFacilitator(): boolean {
    return this.room.participants.some(
      (p) => p.id === this.myParticipantId && p.isFacilitator,
    );
  }

  /** Display name of the current facilitator, when present. */
  facilitatorName(): string | null {
    const facilitator = this.room.participants.find((p) => p.isFacilitator);
    return facilitator?.displayName ?? null;
  }

  setMyCard(card: string): void {
    this.myCard = card;
  }

  applyEvent(event: RoomEvent): void {
    if (event.roomCode !== this.room.code) return;
    const find = (id: string): PublicParticipant | undefined =>
      this.room.participants.find((p) => p.id === id);

    switch (event.type) {
      case "participant.joined":
        if (!find(event.participant.id)) {
          this.room.participants.push({
            id: event.participant.id,
            displayName: event.participant.displayName,
            joinedAt: event.participant.joinedAt,
            isFacilitator: event.participant.isFacilitator,
            connected: true,
            hasSelected: false,
            selectedCard: null,
          });
        }
        break;
      case "participant.left":
        this.room.participants = this.room.participants.filter(
          (p) => p.id !== event.participant.id,
        );
        break;
      case "participant.updated": {
        const participant = find(event.participant.id);
        if (participant) participant.connected = event.participant.connected;
        break;
      }
      case "card.selected": {
        const participant = find(event.participantId);
        if (participant) participant.hasSelected = event.hasSelected;
        break;
      }
      case "cards.revealed": {
        this.room.roundStatus = "revealed";
        for (const p of this.room.participants) {
          p.selectedCard = null;
          p.hasSelected = false;
        }
        for (const card of event.cards) {
          const participant = find(card.participantId);
          if (participant) {
            participant.selectedCard = card.card;
            participant.hasSelected = true;
          }
        }
        const mine = event.cards.find((c) => c.participantId === this.myParticipantId);
        if (mine) this.myCard = mine.card;
        break;
      }
      case "round.started": {
        this.room.roundId = event.roundId;
        this.room.roundStatus = "voting";
        if (event.story) this.room.story = event.story;
        for (const p of this.room.participants) {
          p.hasSelected = false;
          p.selectedCard = null;
        }
        this.myCard = null;
        break;
      }
      case "story.updated":
        this.room.story = event.story;
        break;
    }
  }
}