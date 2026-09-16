export type CardValue =
  | "0"
  | "1"
  | "2"
  | "3"
  | "5"
  | "8"
  | "13"
  | "21"
  | "34"
  | "55"
  | "?"
  | "XS"
  | "S"
  | "M"
  | "L"
  | "XL"
  | "XXL"
  | "coffee";

export type RoundStatus = "waiting" | "voting" | "revealed";

export interface Participant {
  id: string;
  displayName: string;
  joinedAt: string;
  isFacilitator: boolean;
  connected: boolean;
  selectedCard?: CardValue;
}

export interface Story {
  title: string;
  description: string;
  /** Jira issue key, when imported (e.g. "FPB-42"). */
  key?: string;
  /** Link back to the source issue. */
  url?: string;
}

export interface Round {
  id: string;
  story?: Story;
  status: RoundStatus;
  startedAt: string;
  revealedAt?: string;
}

export interface Room {
  id: string;
  code: string;
  createdAt: string;
  expiresAt: string;
  facilitatorId: string;
  participants: Map<string, Participant>;
  currentRound: Round;
  deck: CardValue[];
  /** Last Jira search/filter link used to import stories into this room. */
  jiraFeedUrl?: string;
}

export interface PublicParticipant {
  id: string;
  displayName: string;
  joinedAt: string;
  isFacilitator: boolean;
  connected: boolean;
  hasSelected: boolean;
  selectedCard: CardValue | null;
}

export interface PublicRoom {
  code: string;
  createdAt: string;
  roundId: string;
  roundStatus: RoundStatus;
  story?: Story;
  deck: CardValue[];
  participants: PublicParticipant[];
  self?: {
    participantId: string;
    selectedCard: CardValue | null;
  };
}

export type RoomEvent =
  | ParticipantJoinedEvent
  | ParticipantLeftEvent
  | ParticipantUpdatedEvent
  | CardSelectedEvent
  | CardsRevealedEvent
  | RoundStartedEvent
  | StoryUpdatedEvent;

export interface ParticipantJoinedEvent {
  type: "participant.joined";
  roomCode: string;
  participant: {
    id: string;
    displayName: string;
    joinedAt: string;
    isFacilitator: boolean;
  };
}

export interface ParticipantLeftEvent {
  type: "participant.left";
  roomCode: string;
  participant: { id: string; displayName: string };
}

export interface ParticipantUpdatedEvent {
  type: "participant.updated";
  roomCode: string;
  participant: { id: string; displayName: string; connected: boolean };
}

export interface CardSelectedEvent {
  type: "card.selected";
  roomCode: string;
  participantId: string;
  hasSelected: boolean;
}

export interface CardsRevealedEvent {
  type: "cards.revealed";
  roomCode: string;
  cards: Array<{ participantId: string; displayName: string; card: CardValue }>;
}

export interface RoundStartedEvent {
  type: "round.started";
  roomCode: string;
  roundId: string;
  story?: Story;
  deck: CardValue[];
}

export interface StoryUpdatedEvent {
  type: "story.updated";
  roomCode: string;
  story: Story;
}

export type ClientMessage =
  | { type: "connect"; roomCode: string; participantId: string }
  | { type: "ping" };