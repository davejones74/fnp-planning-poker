import type {
  CardValue,
  Participant,
  PublicRoom,
  Room,
  Round,
  Story,
} from "../../../shared/types.ts";
import { DECKS } from "../../../shared/decks.ts";
import { isValidRoomCode } from "../../../shared/validation.ts";
import {
  DISPLAY_NAME_MAX,
  STORY_DESCRIPTION_MAX,
  STORY_TITLE_MAX,
} from "../../../shared/validation.ts";
import { ApiError } from "../shared/errors.ts";
import { generateId } from "../shared/ids.ts";
import { createRoomCode } from "./roomCodes.ts";
import { toPublicRoom } from "./publicRoom.ts";
import type { PubSubService } from "./PubSubService.ts";
import type { RoomRepository } from "./RoomRepository.ts";

export interface RoomServiceOptions {
  deck?: CardValue[];
  roomExpiryHours?: number;
}

export interface JoinResult {
  room: Room;
  participant: Participant;
}

const MILLIS_PER_HOUR = 3_600_000;

export class RoomService {
  private readonly deck: readonly CardValue[];
  private readonly roomExpiryMs: number;

  private readonly repo: RoomRepository;
  private readonly pubsub: PubSubService;
  private readonly now: () => Date;

  constructor(
    repo: RoomRepository,
    pubsub: PubSubService,
    options: RoomServiceOptions = {},
    now: () => Date = () => new Date(),
  ) {
    this.repo = repo;
    this.pubsub = pubsub;
    this.deck = options.deck ?? DECKS.fibonacci;
    const hours = options.roomExpiryHours ?? 24;
    this.roomExpiryMs =
      (Number.isFinite(hours) && hours > 0 ? hours : 24) * MILLIS_PER_HOUR;
    this.now = now;
  }

  async createRoom(rawDisplayName: unknown): Promise<{ room: Room; participant: Participant }> {
    const displayName = this.requireDisplayName(rawDisplayName);
    const code = await this.generateUniqueCode();
    const facilitator: Participant = {
      id: generateId("p"),
      displayName,
      joinedAt: this.iso(this.now()),
      isFacilitator: true,
      connected: true,
    };
    const round: Round = {
      id: generateId("r"),
      status: "voting",
      startedAt: this.iso(this.now()),
    };
    const room: Room = {
      id: generateId("room"),
      code,
      createdAt: this.iso(this.now()),
      expiresAt: this.expiresAt(),
      facilitatorId: facilitator.id,
      participants: new Map([[facilitator.id, facilitator]]),
      currentRound: round,
      deck: [...this.deck],
    };
    await this.repo.create(room);
    return { room, participant: facilitator };
  }

  async joinRoom(
    code: string,
    rawDisplayName: unknown,
    requestedParticipantId?: unknown,
  ): Promise<JoinResult> {
    const room = await this.loadRoom(code);
    const displayName = this.requireDisplayName(rawDisplayName);

    if (typeof requestedParticipantId === "string") {
      const existing = room.participants.get(requestedParticipantId);
      if (existing) return { room, participant: existing };
    }

    const participant: Participant = {
      id: generateId("p"),
      displayName,
      joinedAt: this.iso(this.now()),
      isFacilitator: false,
      connected: true,
    };
    room.participants.set(participant.id, participant);
    await this.persist(room);
    await this.pubsub.publishToRoom(room.code, {
      type: "participant.joined",
      roomCode: room.code,
      participant: {
        id: participant.id,
        displayName: participant.displayName,
        joinedAt: participant.joinedAt,
        isFacilitator: participant.isFacilitator,
      },
    });
    return { room, participant };
  }

  async getRoom(code: string, viewerId?: unknown): Promise<PublicRoom> {
    const room = await this.loadRoom(code);
    await this.persist(room);
    return toPublicRoom(room, typeof viewerId === "string" ? viewerId : undefined);
  }

  async getParticipants(code: string): Promise<PublicRoom["participants"]> {
    const room = await this.loadRoom(code);
    await this.persist(room);
    return toPublicRoom(room).participants;
  }

  async getParticipant(code: string, participantId: string): Promise<Participant> {
    const room = await this.loadRoom(code);
    await this.persist(room);
    return this.requireParticipant(room, participantId);
  }

  async selectCard(code: string, participantId: string, rawCard: unknown): Promise<void> {
    const room = await this.loadRoom(code);
    const participant = this.requireParticipant(room, participantId);
    this.requireVoting(room.currentRound);
    if (typeof rawCard !== "string" || !room.deck.includes(rawCard as CardValue)) {
      throw new ApiError("INVALID_CARD", 400, "Unknown card value for this deck.");
    }
    participant.selectedCard = rawCard as CardValue;
    await this.persist(room);
    // Do NOT broadcast the card value while voting is in progress.
    await this.pubsub.publishToRoom(room.code, {
      type: "card.selected",
      roomCode: room.code,
      participantId,
      hasSelected: true,
    });
  }

  async revealCards(code: string, participantId: string): Promise<void> {
    const room = await this.loadRoom(code);
    this.requireFacilitator(room, participantId);
    this.requireVoting(room.currentRound);
    room.currentRound.status = "revealed";
    room.currentRound.revealedAt = this.iso(this.now());
    const cards = [...room.participants.values()]
      .filter((p) => p.selectedCard !== undefined)
      .map((p) => ({
        participantId: p.id,
        displayName: p.displayName,
        card: p.selectedCard as CardValue,
      }));
    await this.persist(room);
    await this.pubsub.publishToRoom(room.code, {
      type: "cards.revealed",
      roomCode: room.code,
      cards,
    });
  }

  async newRound(
    code: string,
    participantId: string,
  ): Promise<{ room: Room; round: Round }> {
    const room = await this.loadRoom(code);
    this.requireFacilitator(room, participantId);
    const round: Round = {
      id: generateId("r"),
      story: room.currentRound.story,
      status: "voting",
      startedAt: this.iso(this.now()),
    };
    for (const participant of room.participants.values()) {
      participant.selectedCard = undefined;
    }
    room.currentRound = round;
    await this.persist(room);
    await this.pubsub.publishToRoom(room.code, {
      type: "round.started",
      roomCode: room.code,
      roundId: round.id,
      story: round.story,
      deck: room.deck,
    });
    return { room, round };
  }

  async updateStory(code: string, participantId: string, raw: unknown): Promise<Story> {
    const room = await this.loadRoom(code);
    this.requireFacilitator(room, participantId);
    const story = this.validateStory(raw);
    room.currentRound.story = story;
    await this.persist(room);
    await this.pubsub.publishToRoom(room.code, {
      type: "story.updated",
      roomCode: room.code,
      story,
    });
    return story;
  }

  async removeParticipant(
    code: string,
    facilitatorId: string,
    targetParticipantId: string,
  ): Promise<void> {
    const room = await this.loadRoom(code);
    this.requireFacilitator(room, facilitatorId);
    const target = room.participants.get(targetParticipantId);
    if (!target) {
      throw new ApiError("CONFLICT", 404, "Participant not found in room.");
    }
    if (targetParticipantId === facilitatorId) {
      throw new ApiError("CONFLICT", 409, "The facilitator cannot remove themselves.");
    }
    room.participants.delete(targetParticipantId);
    await this.persist(room);
    await this.pubsub.publishToRoom(room.code, {
      type: "participant.left",
      roomCode: room.code,
      participant: { id: target.id, displayName: target.displayName },
    });
  }

  async handleConnect(code: string, participantId: string): Promise<void> {
    const room = await this.loadRoom(code);
    const participant = this.requireParticipant(room, participantId);
    if (participant.connected) return;
    participant.connected = true;
    await this.persist(room);
    await this.pubsub.publishToRoom(room.code, {
      type: "participant.updated",
      roomCode: room.code,
      participant: {
        id: participant.id,
        displayName: participant.displayName,
        connected: true,
      },
    });
  }

  async handleDisconnect(code: string, participantId: string): Promise<void> {
    try {
      const room = await this.loadRoom(code);
      const participant = room.participants.get(participantId);
      if (!participant || !participant.connected) return;
      participant.connected = false;
      await this.persist(room);
      await this.pubsub.publishToRoom(room.code, {
        type: "participant.updated",
        roomCode: room.code,
        participant: {
          id: participant.id,
          displayName: participant.displayName,
          connected: false,
        },
      });
    } catch {
      // Room or participant may already be gone; treat as a no-op.
    }
  }

  private async loadRoom(code: string): Promise<Room> {
    if (!isValidRoomCode(code)) {
      throw new ApiError(
        "INVALID_ROOM_CODE",
        400,
        "Room code must be exactly 6 characters from the allowed alphabet.",
      );
    }
    const room = await this.repo.get(code);
    if (!room) {
      throw new ApiError("ROOM_NOT_FOUND", 404, "The requested room does not exist.");
    }
    if (this.now().getTime() >= new Date(room.expiresAt).getTime()) {
      await this.repo.delete(code);
      throw new ApiError(
        "ROOM_EXPIRED",
        404,
        "This room has expired and has been removed.",
      );
    }
    this.touch(room);
    return room;
  }

  private requireVoting(round: Round): void {
    if (round.status !== "voting") {
      throw new ApiError("VOTING_CLOSED", 409, "Voting is not open in this round.");
    }
  }

  private requireParticipant(room: Room, participantId: string): Participant {
    const participant = room.participants.get(participantId);
    if (!participant) {
      throw new ApiError("NOT_IN_ROOM", 403, "You are not a participant of this room.");
    }
    return participant;
  }

  private requireFacilitator(room: Room, participantId: string): Participant {
    const participant = this.requireParticipant(room, participantId);
    if (!participant.isFacilitator) {
      throw new ApiError(
        "NOT_FACILITATOR",
        403,
        "Only the facilitator can perform this action.",
      );
    }
    return participant;
  }

  private requireDisplayName(raw: unknown): string {
    if (typeof raw !== "string") {
      throw new ApiError("INVALID_REQUEST", 400, "displayName is required.");
    }
    const name = raw.trim();
    if (name.length < 1 || name.length > DISPLAY_NAME_MAX) {
      throw new ApiError(
        "INVALID_REQUEST",
        400,
        `displayName must be between 1 and ${DISPLAY_NAME_MAX} characters.`,
      );
    }
    return name;
  }

  private validateStory(raw: unknown): Story {
    if (typeof raw !== "object" || raw === null) {
      throw new ApiError(
        "INVALID_REQUEST",
        400,
        "Story title and description are required.",
      );
    }
    const { title: rawTitle, description: rawDescription } = raw as {
      title?: unknown;
      description?: unknown;
    };
    if (typeof rawTitle !== "string") {
      throw new ApiError("INVALID_REQUEST", 400, "Story title is required.");
    }
    const title = rawTitle.trim();
    if (title.length < 1 || title.length > STORY_TITLE_MAX) {
      throw new ApiError(
        "INVALID_REQUEST",
        400,
        `Story title must be between 1 and ${STORY_TITLE_MAX} characters.`,
      );
    }
    let description = "";
    if (rawDescription !== undefined && rawDescription !== null) {
      if (typeof rawDescription !== "string") {
        throw new ApiError("INVALID_REQUEST", 400, "Story description must be text.");
      }
      description = rawDescription.trim();
      if (description.length > STORY_DESCRIPTION_MAX) {
        throw new ApiError(
          "INVALID_REQUEST",
          400,
          `Story description must be at most ${STORY_DESCRIPTION_MAX} characters.`,
        );
      }
    }
    return { title, description };
  }

  private touch(room: Room): void {
    room.expiresAt = this.expiresAt();
  }

  private expiresAt(): string {
    return this.iso(new Date(this.now().getTime() + this.roomExpiryMs));
  }

  private iso(date: Date): string {
    return date.toISOString();
  }

  private async persist(room: Room): Promise<void> {
    await this.repo.update(room);
  }

  private async generateUniqueCode(): Promise<string> {
    for (let attempt = 0; attempt < 100; attempt++) {
      const code = createRoomCode();
      if (!(await this.repo.get(code))) return code;
    }
    throw new ApiError("INTERNAL_ERROR", 500, "Unable to allocate a room code.");
  }
}