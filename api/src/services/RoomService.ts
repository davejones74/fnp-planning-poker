import type {
  CardValue,
  Participant,
  PublicRoom,
  Room,
  Round,
  SessionStory,
  Story,
} from "../../../shared/types.ts";
import { DECKS } from "../../../shared/decks.ts";
import { isValidRoomCode } from "../../../shared/validation.ts";
import {
  DISPLAY_NAME_MAX,
  MAX_ROOM_PARTICIPANTS,
  MAX_SESSION_STORIES,
  STORY_DESCRIPTION_MAX,
  STORY_KEY_MAX,
  STORY_TITLE_MAX,
  STORY_URL_MAX,
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
  participantOfflineGraceMinutes?: number;
}

export interface JoinResult {
  room: Room;
  participant: Participant;
}

const MILLIS_PER_HOUR = 3_600_000;

function connectionKey(roomCode: string, participantId: string): string {
  return `${roomCode}:${participantId}`;
}

/** Names are unique per room when compared case-insensitively and trimmed. */
function normalizeName(name: string): string {
  return name.trim().toLocaleLowerCase();
}

export class RoomService {
  private readonly deck: readonly CardValue[];
  private readonly roomExpiryMs: number;
  private readonly participantOfflineGraceMs: number;

  private readonly repo: RoomRepository;
  private readonly pubsub: PubSubService;
  private readonly now: () => Date;

  /** Tracks active connections per participant: "roomCode:participantId" -> Set<connectionId> */
  private readonly connections = new Map<string, Set<string>>();

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
    const graceMinutes = options.participantOfflineGraceMinutes ?? 60;
    this.participantOfflineGraceMs =
      (Number.isFinite(graceMinutes) && graceMinutes > 0 ? graceMinutes : 60) * 60_000;
    this.now = now;
  }

  async createRoom(rawDisplayName: unknown): Promise<{ room: Room; participant: Participant }> {
    const displayName = this.requireDisplayName(rawDisplayName);
    const code = await this.generateUniqueCode();
    const nowIso = this.iso(this.now());
    const facilitator: Participant = {
      id: generateId("p"),
      displayName,
      joinedAt: nowIso,
      lastSeenAt: nowIso,
      isFacilitator: true,
      connected: true,
    };
    const round: Round = {
      id: generateId("r"),
      status: "voting",
      startedAt: nowIso,
    };
    const room: Room = {
      id: generateId("room"),
      code,
      createdAt: nowIso,
      expiresAt: this.expiresAt(),
      facilitatorId: facilitator.id,
      participants: new Map([[facilitator.id, facilitator]]),
      currentRound: round,
      deck: [...this.deck],
      stories: [],
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
    const nowIso = this.iso(this.now());

    if (typeof requestedParticipantId === "string") {
      const existing = room.participants.get(requestedParticipantId);
      if (existing) {
        // Resuming after an offline spell must put the participant back online
        // for everyone else; otherwise rejoiners stay red until a socket event.
        existing.lastSeenAt = nowIso;
        if (!existing.connected) {
          existing.connected = true;
          await this.persist(room);
          await this.pubsub.publishToRoom(room.code, {
            type: "participant.updated",
            roomCode: room.code,
            participant: {
              id: existing.id,
              displayName: existing.displayName,
              connected: true,
            },
          });
        }
        return { room, participant: existing };
      }
    }

    // Names are unique per room: a fresh participant reusing a name already in
    // the room replaces the previous holder of that name (the newest wins), so
    // the roster never shows duplicates. The replaced participant's sockets are
    // dropped to free a Web PubSub connection. The facilitator is protected
    // while online — a colleague switching devices cannot hijack the name mid
    // room — but once the original tab drops (or is flagged offline after the
    // grace period), a same-name rejoin reclaims the name and the role.
    const replacedParticipant = this.findParticipantByName(room, displayName);
    let replacingFacilitator = false;
    if (replacedParticipant) {
      if (replacedParticipant.isFacilitator && replacedParticipant.connected) {
        throw new ApiError(
          "NAME_TAKEN",
          409,
          `"${displayName}" is already in this room as the facilitator.`,
        );
      }
      replacingFacilitator = replacedParticipant.isFacilitator;
      room.participants.delete(replacedParticipant.id);
      this.connections.delete(connectionKey(room.code, replacedParticipant.id));
    }

    if (room.participants.size >= MAX_ROOM_PARTICIPANTS) {
      throw new ApiError(
        "ROOM_FULL",
        409,
        `This room is full (maximum ${MAX_ROOM_PARTICIPANTS} connections on the free tier).`,
      );
    }

    const participant: Participant = {
      id: generateId("p"),
      displayName,
      joinedAt: nowIso,
      lastSeenAt: nowIso,
      isFacilitator: replacingFacilitator,
      connected: true,
    };
    room.participants.set(participant.id, participant);
    if (replacingFacilitator) room.facilitatorId = participant.id;
    await this.persist(room);

    if (replacedParticipant) {
      await this.pubsub.publishToRoom(room.code, {
        type: "participant.left",
        roomCode: room.code,
        participant: {
          id: replacedParticipant.id,
          displayName: replacedParticipant.displayName,
        },
      });
      // Drop the replaced participant's sockets so they stop consuming one of
      // the 20 Web PubSub connections and cannot keep receiving room events.
      this.pubsub.disconnectParticipant(room.code, replacedParticipant.id);
    }
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

  /**
   * Presence heartbeat from a live browser tab. Refreshes lastSeenAt so the
   * stale-sweep never mistakes this participant for a ghost, and revives a
   * participant whose Web PubSub disconnect event was lost (the only thing
   * that reliably proves a participant is still here is a tab still pinging).
   */
  async touchParticipant(code: string, participantId: string): Promise<void> {
    const room = await this.loadRoom(code);
    const participant = this.requireParticipant(room, participantId);
    const wasOffline = !participant.connected;
    participant.lastSeenAt = this.iso(this.now());
    if (wasOffline) participant.connected = true;
    await this.persist(room);
    if (wasOffline) {
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

  async assertFacilitator(code: string, participantId: string): Promise<void> {
    const room = await this.loadRoom(code);
    this.requireFacilitator(room, participantId);
  }

  async getJiraFeedUrl(code: string, participantId: string): Promise<string | null> {
    const room = await this.loadRoom(code);
    this.requireFacilitator(room, participantId);
    return room.jiraFeedUrl ?? null;
  }

  async setJiraFeedUrl(code: string, participantId: string, url: string): Promise<void> {
    const room = await this.loadRoom(code);
    this.requireFacilitator(room, participantId);
    room.jiraFeedUrl = url;
    await this.persist(room);
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

  /**
   * Adds stories to the room's session backlog (upsert by key). Existing
   * stories keep their status and agreed estimate. Returns an import summary
   * and the full backlog.
   */
  async importStories(
    code: string,
    participantId: string,
    raw: unknown,
  ): Promise<{
    imported: number;
    duplicatesSkipped: number;
    invalidSkipped: number;
    limitSkipped: number;
    stories: SessionStory[];
  }> {
    const room = await this.loadRoom(code);
    this.requireFacilitator(room, participantId);

    const items = this.readRawStories(raw);
    const byKey = new Map(room.stories.map((story) => [story.key, story]));
    let imported = 0;
    let duplicatesSkipped = 0;
    let invalidSkipped = 0;
    let limitSkipped = 0;

    for (const item of items) {
      const parsed = this.parseImportedStory(item);
      if (!parsed) {
        invalidSkipped++;
        continue;
      }
      const existing = byKey.get(parsed.key);
      if (existing) {
        existing.title = parsed.title;
        existing.description = parsed.description;
        existing.url = parsed.url;
        duplicatesSkipped++;
        continue;
      }
      if (room.stories.length >= MAX_SESSION_STORIES) {
        limitSkipped++;
        continue;
      }
      const story: SessionStory = {
        key: parsed.key,
        title: parsed.title,
        description: parsed.description,
        status: "ready",
      };
      if (parsed.url) story.url = parsed.url;
      room.stories.push(story);
      byKey.set(story.key, story);
      imported++;
    }

    await this.persist(room);
    await this.publishStories(room);
    return {
      imported,
      duplicatesSkipped,
      invalidSkipped,
      limitSkipped,
      stories: room.stories.map((s) => ({ ...s })),
    };
  }

  /**
   * Selects a backlog story and starts a new estimation round associated with
   * it. Selecting a story does not start the round on its own — the
   * facilitator must explicitly start the estimation here.
   */
  async startStoryEstimation(
    code: string,
    participantId: string,
    rawKey: unknown,
  ): Promise<{ room: Room; round: Round; story: SessionStory }> {
    const room = await this.loadRoom(code);
    this.requireFacilitator(room, participantId);
    const key = this.requireStoryKey(rawKey);
    const story = this.requireSessionStory(room, key);
    if (story.status === "estimated") {
      throw new ApiError(
        "STORY_ALREADY_ESTIMATED",
        409,
        `${key} has already been estimated.`,
      );
    }

    story.status = "estimating";
    const round: Round = {
      id: generateId("r"),
      story: { ...story },
      status: "voting",
      startedAt: this.iso(this.now()),
    };
    for (const participant of room.participants.values()) {
      participant.selectedCard = undefined;
    }
    room.currentRound = round;
    await this.persist(room);
    await this.publishStories(room);
    await this.pubsub.publishToRoom(room.code, {
      type: "round.started",
      roomCode: room.code,
      roundId: round.id,
      story: round.story,
      deck: room.deck,
    });
    return { room, round, story: { ...story } };
  }

  /**
   * Records the facilitator's agreed estimate for the current round's story.
   * Only the facilitator may do this, the round must be revealed, and the
   * estimate must be a valid deck value. The story moves to `estimated` and
   * the room is prepared for the next (story-free) round.
   */
  async recordAgreedEstimate(
    code: string,
    participantId: string,
    rawKey: unknown,
    rawEstimate: unknown,
  ): Promise<{ story: SessionStory }> {
    const room = await this.loadRoom(code);
    this.requireFacilitator(room, participantId);
    const key = this.requireStoryKey(rawKey);
    const story = this.requireSessionStory(room, key);
    if (room.currentRound.status !== "revealed") {
      throw new ApiError("VOTING_CLOSED", 409, "Reveal the cards before recording an estimate.");
    }
    if (!room.currentRound.story || room.currentRound.story.key !== key) {
      throw new ApiError("STORY_NOT_ACTIVE", 409, `${key} is not the current estimation story.`);
    }
    if (typeof rawEstimate !== "string" || !room.deck.includes(rawEstimate as CardValue)) {
      throw new ApiError("INVALID_CARD", 400, "Unknown card value for this deck.");
    }

    story.agreedEstimate = rawEstimate as CardValue;
    story.estimatedAt = this.iso(this.now());
    story.status = "estimated";

    const round: Round = {
      id: generateId("r"),
      status: "voting",
      startedAt: this.iso(this.now()),
    };
    for (const participant of room.participants.values()) {
      participant.selectedCard = undefined;
    }
    room.currentRound = round;
    await this.persist(room);
    await this.publishStories(room);
    await this.pubsub.publishToRoom(room.code, {
      type: "round.started",
      roomCode: room.code,
      roundId: round.id,
      deck: room.deck,
    });
    return { story: { ...story } };
  }

  /**
   * Removes the selected stories from the session backlog. Facilitator-only.
   * Only `estimated` stories can be dismissed; any keys that are missing or
   * not yet estimated are counted as skipped. Persists and publishes the
   * updated backlog so every participant sees the change.
   */
  async dismissStories(
    code: string,
    participantId: string,
    rawKeys: unknown,
  ): Promise<{ dismissed: number; skipped: number }> {
    const room = await this.loadRoom(code);
    this.requireFacilitator(room, participantId);
    const keys = this.parseStoryKeys(rawKeys);
    let dismissed = 0;
    let skipped = 0;
    const seen = new Set<string>();
    const remaining: SessionStory[] = [];
    for (const story of room.stories) {
      if (keys.has(story.key)) {
        seen.add(story.key);
        if (story.status === "estimated") {
          dismissed += 1;
          continue;
        }
        skipped += 1;
      }
      remaining.push(story);
    }
    skipped += keys.size - seen.size;
    if (keys.size === 0 || dismissed === 0) {
      throw new ApiError(
        "INVALID_REQUEST",
        400,
        "Select at least one completed story to dismiss.",
      );
    }
    room.stories = remaining;
    await this.persist(room);
    await this.publishStories(room);
    return { dismissed, skipped };
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
    this.connections.delete(connectionKey(room.code, targetParticipantId));
    await this.persist(room);
    await this.pubsub.publishToRoom(room.code, {
      type: "participant.left",
      roomCode: room.code,
      participant: { id: target.id, displayName: target.displayName },
    });
    // Drop the kicked participant's sockets so they stop consuming one of the
    // 20 Web PubSub connections and cannot keep receiving room events.
    this.pubsub.disconnectParticipant(room.code, targetParticipantId);
  }

  /** Allows a participant to explicitly leave the room. */
  async leaveRoom(code: string, participantId: string): Promise<void> {
    const room = await this.loadRoom(code);
    const target = room.participants.get(participantId);
    if (!target) {
      throw new ApiError("NOT_IN_ROOM", 403, "You are not a participant of this room.");
    }
    room.participants.delete(participantId);
    this.connections.delete(connectionKey(room.code, participantId));
    const wasFacilitator = target.isFacilitator;
    if (wasFacilitator) this.promoteNextFacilitator(room);
    await this.persist(room);
    await this.pubsub.publishToRoom(room.code, {
      type: "participant.left",
      roomCode: room.code,
      participant: { id: target.id, displayName: target.displayName },
    });
    this.pubsub.disconnectParticipant(room.code, participantId);
  }

  /**
   * Promotes the next participant (earliest joined, preferring online) to facilitator.
   * If no participants remain, the room is left without a facilitator.
   */
  private promoteNextFacilitator(room: Room): void {
    const candidates = [...room.participants.values()].sort(
      (a, b) => a.joinedAt.localeCompare(b.joinedAt),
    );
    const next = candidates.find((p) => p.connected) ?? candidates[0];
    if (!next) {
      room.facilitatorId = "";
      return;
    }
    next.isFacilitator = true;
    room.facilitatorId = next.id;
    // Notify clients of the new facilitator
    this.pubsub.publishToRoom(room.code, {
      type: "participant.updated",
      roomCode: room.code,
      participant: {
        id: next.id,
        displayName: next.displayName,
        connected: next.connected,
        isFacilitator: true,
      },
    });
  }

  async handleConnect(
    code: string,
    participantId: string,
    connectionId: string,
  ): Promise<void> {
    const room = await this.loadRoom(code);
    const participant = this.requireParticipant(room, participantId);
    const key = connectionKey(room.code, participantId);
    let set = this.connections.get(key);
    if (!set) {
      set = new Set();
      this.connections.set(key, set);
    }
    const firstConnection = set.size === 0;
    set.add(connectionId);
    participant.lastSeenAt = this.iso(this.now());
    if (firstConnection || !participant.connected) {
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
  }

  async handleDisconnect(
    code: string,
    participantId: string,
    connectionId: string,
  ): Promise<void> {
    try {
      const room = await this.loadRoom(code);
      const participant = room.participants.get(participantId);
      if (!participant) return;
      const key = connectionKey(room.code, participantId);
      const set = this.connections.get(key);
      let remaining = 0;
      if (set) {
        set.delete(connectionId);
        remaining = set.size;
        if (remaining === 0) this.connections.delete(key);
      }
      if (remaining > 0) return; // still has live connections
      if (!participant.connected) return;
      participant.connected = false;
      participant.lastSeenAt = this.iso(this.now());
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
    const flagged = this.markStaleOffline(room);
    if (flagged.length > 0) await this.persist(room);
    return room;
  }

  /**
   * Flags participants offline when their presence has not been refreshed
   * within the grace period. The roster is never pruned here — names remain
   * until an explicit leave or kick. Web PubSub disconnect events can be lost,
   * so a participant still flagged online with no live heartbeat must be
   * treated as having dropped off; a future heartbeat or resume revives them.
   */
  private markStaleOffline(room: Room): { id: string; displayName: string }[] {
    const now = this.now().getTime();
    const flagged: { id: string; displayName: string }[] = [];
    for (const [id, participant] of room.participants) {
      if (!participant.connected) continue;
      const lastSeen = participant.lastSeenAt
        ? new Date(participant.lastSeenAt).getTime()
        : new Date(participant.joinedAt).getTime();
      if (now - lastSeen >= this.participantOfflineGraceMs) {
        participant.connected = false;
        flagged.push({ id, displayName: participant.displayName });
      }
    }
    for (const participant of flagged) {
      this.pubsub.publishToRoom(room.code, {
        type: "participant.updated",
        roomCode: room.code,
        participant: {
          id: participant.id,
          displayName: participant.displayName,
          connected: false,
        },
      });
    }
    return flagged;
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

  private findParticipantByName(room: Room, displayName: string): Participant | undefined {
    const wanted = normalizeName(displayName);
    for (const participant of room.participants.values()) {
      if (normalizeName(participant.displayName) === wanted) return participant;
    }
    return undefined;
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
    const story: Story = { title, description };
    const { key: rawKey, url: rawUrl } = raw as {
      key?: unknown;
      url?: unknown;
    };
    if (typeof rawKey === "string") {
      const key = rawKey.trim();
      if (key.length > 20) {
        throw new ApiError("INVALID_REQUEST", 400, "Story key must be at most 20 characters.");
      }
      if (key) story.key = key;
    }
    if (typeof rawUrl === "string") {
      const url = rawUrl.trim();
      if (url.length > 500) {
        throw new ApiError("INVALID_REQUEST", 400, "Story link must be at most 500 characters.");
      }
      if (url) story.url = url;
    }
    return story;
  }

  private readRawStories(raw: unknown): Array<Record<string, unknown>> {
    if (typeof raw !== "object" || raw === null) {
      throw new ApiError("INVALID_REQUEST", 400, "Import bodies must contain a stories array.");
    }
    const { stories: items } = raw as { stories?: unknown };
    if (!Array.isArray(items)) {
      throw new ApiError("INVALID_REQUEST", 400, "Import bodies must contain a stories array.");
    }
    const records: Array<Record<string, unknown>> = [];
    for (const item of items) {
      if (typeof item === "object" && item !== null) {
        records.push(item as Record<string, unknown>);
      }
    }
    return records;
  }

  /** Validates a single imported story, returning null when the row is unusable. */
  private parseImportedStory(
    raw: Record<string, unknown>,
  ): { key: string; title: string; description: string; url?: string } | null {
    const rawKey = raw.key;
    if (typeof rawKey !== "string") return null;
    const key = rawKey.trim().toUpperCase();
    if (key.length < 1 || key.length > STORY_KEY_MAX) return null;

    const rawTitle = raw.title;
    if (typeof rawTitle !== "string") return null;
    const title = rawTitle.trim();
    if (title.length < 1 || title.length > STORY_TITLE_MAX) return null;

    let description = "";
    if (typeof raw.description === "string") {
      description = raw.description.trim().slice(0, STORY_DESCRIPTION_MAX);
    }

    const parsed: { key: string; title: string; description: string; url?: string } = {
      key,
      title,
      description,
    };
    if (typeof raw.url === "string") {
      const url = raw.url.trim();
      if (url.length > STORY_URL_MAX) return null;
      if (url) parsed.url = url;
    }
    return parsed;
  }

  private requireStoryKey(raw: unknown): string {
    if (typeof raw !== "string") {
      throw new ApiError("INVALID_REQUEST", 400, "Story key is required.");
    }
    const key = raw.trim().toUpperCase();
    if (key.length < 1 || key.length > STORY_KEY_MAX) {
      throw new ApiError(
        "INVALID_REQUEST",
        400,
        `Story key must be between 1 and ${STORY_KEY_MAX} characters.`,
      );
    }
    return key;
  }

  private parseStoryKeys(rawKeys: unknown): Set<string> {
    if (!Array.isArray(rawKeys)) {
      throw new ApiError("INVALID_REQUEST", 400, "keys must be an array of story keys.");
    }
    const keys = new Set<string>();
    for (const raw of rawKeys) {
      if (typeof raw !== "string") continue;
      const key = raw.trim().toUpperCase();
      if (key.length >= 1 && key.length <= STORY_KEY_MAX) keys.add(key);
    }
    return keys;
  }

  private requireSessionStory(room: Room, key: string): SessionStory {
    const story = room.stories.find((s) => s.key === key);
    if (!story) {
      throw new ApiError("STORY_NOT_FOUND", 404, `No story found with key ${key}.`);
    }
    return story;
  }

  private async publishStories(room: Room): Promise<void> {
    await this.pubsub.publishToRoom(room.code, {
      type: "stories.updated",
      roomCode: room.code,
      stories: room.stories.map((s) => ({ ...s })),
    });
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