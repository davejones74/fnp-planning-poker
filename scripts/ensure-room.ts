import { TableClient } from "@azure/data-tables";
import {
  DECKS,
  DEFAULT_DECK_ID,
  deckById,
  type DeckDefinition,
} from "../shared/decks.ts";
import type { DeckId, Participant, Room, Round } from "../shared/types.ts";
import { generateId } from "../api/src/shared/ids.ts";
import {
  fromEntity,
  toEntity,
} from "../api/src/services/CosmosTableRoomRepository.ts";

const PARTITION_KEY = "rooms";
const MIGRATIONS_PARTITION = "migrations";
const MILLIS_PER_DAY = 86_400_000;

function normalize(name: string): string {
  return name.trim().toLocaleLowerCase();
}

function facilitatorMarkerKey(code: string, facilitatorName: string): string {
  const slug = normalize(facilitatorName).replace(/[^a-z0-9]+/g, "-");
  return `${code.toLowerCase()}-${slug}-facilitator`;
}

function deckMarkerKey(code: string, deckId: DeckId): string {
  return `${code.toLowerCase()}-${deckId}-deck`;
}

function createFreshRoom(
  code: string,
  facilitatorName: string,
  now: Date,
  deck: DeckDefinition,
): Room {
  const nowIso = now.toISOString();
  const facilitator: Participant = {
    id: generateId("p"),
    displayName: facilitatorName,
    joinedAt: nowIso,
    lastSeenAt: nowIso,
    isFacilitator: true,
    connected: false,
  };
  const round: Round = {
    id: generateId("r"),
    status: "voting",
    startedAt: nowIso,
  };
  return {
    id: generateId("room"),
    code,
    createdAt: nowIso,
    expiresAt: nowIso,
    facilitatorId: facilitator.id,
    facilitatorName: facilitator.displayName,
    participants: new Map([[facilitator.id, facilitator]]),
    currentRound: round,
    deckId: deck.id,
    deck: [...deck.cards],
    stories: [],
  };
}

function sameDeck(room: Room, deck: DeckDefinition): boolean {
  return (
    room.deckId === deck.id &&
    room.deck.length === deck.cards.length &&
    room.deck.every((card, index) => card === deck.cards[index])
  );
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    (error as { statusCode?: number }).statusCode === 404
  );
}

async function main(): Promise<void> {
  const connectionString = process.env.COSMOS_TABLE_CONNECTION_STRING?.trim();
  if (!connectionString) {
    console.log(
      "[ensure-room] COSMOS_TABLE_CONNECTION_STRING is not set; skipping.",
    );
    return;
  }

  const code = (process.env.SEED_ROOM_CODE ?? "Z58WPJ").trim().toUpperCase();
  const facilitatorName = (process.env.SEED_FACILITATOR_NAME ?? "Sian").trim();
  const tableName = process.env.COSMOS_TABLE_NAME?.trim() || "rooms";
  const extendDays = Number(process.env.SEED_EXTEND_DAYS ?? "30");
  const force = process.env.SEED_FORCE === "1";
  const requestedDeck = process.env.SEED_DECK?.trim();
  if (!facilitatorName) {
    throw new Error("SEED_FACILITATOR_NAME must not be empty.");
  }
  const seedDeck = requestedDeck ? deckById(requestedDeck) : undefined;
  if (requestedDeck && !seedDeck) {
    throw new Error(`Unknown SEED_DECK "${requestedDeck}".`);
  }
  const lifetimeDays =
    Number.isFinite(extendDays) && extendDays > 0 ? extendDays : 30;

  const client = TableClient.fromConnectionString(connectionString, tableName);
  await client.createTable();

  const markerExists = async (rowKey: string): Promise<boolean> => {
    try {
      await client.getEntity(MIGRATIONS_PARTITION, rowKey);
      return true;
    } catch (error) {
      if (!isNotFound(error)) throw error;
      return false;
    }
  };

  const now = new Date();
  const nowIso = now.toISOString();
  let room: Room;
  let existed = false;
  try {
    const entity = await client.getEntity(PARTITION_KEY, code);
    room = fromEntity(entity as unknown as Parameters<typeof fromEntity>[0]);
    existed = true;
  } catch (error) {
    if (!isNotFound(error)) throw error;
    room = createFreshRoom(
      code,
      facilitatorName,
      now,
      seedDeck ?? (DECKS[DEFAULT_DECK_ID] as DeckDefinition),
    );
  }

  const facilitatorMarker = facilitatorMarkerKey(code, facilitatorName);
  const deckMarker = seedDeck ? deckMarkerKey(code, seedDeck.id) : null;
  const facilitatorApplied =
    force || !existed || !(await markerExists(facilitatorMarker));
  const deckApplied =
    seedDeck !== undefined &&
    (force || !existed || !(await markerExists(deckMarker as string)));

  if (!facilitatorApplied && !deckApplied) {
    console.log(
      `[ensure-room] ${code} already seeded (marker ${facilitatorMarker}); nothing to do.`,
    );
    return;
  }

  if (facilitatorApplied) {
    let facilitator = [...room.participants.values()].find(
      (participant) =>
        normalize(participant.displayName) === normalize(facilitatorName),
    );
    if (!facilitator) {
      facilitator = {
        id: generateId("p"),
        displayName: facilitatorName,
        joinedAt: nowIso,
        lastSeenAt: nowIso,
        isFacilitator: true,
        connected: false,
      };
      room.participants.set(facilitator.id, facilitator);
    }
    // Exactly one facilitator: the named participant.
    for (const participant of room.participants.values()) {
      participant.isFacilitator = participant.id === facilitator.id;
    }
    room.facilitatorId = facilitator.id;
    room.facilitatorName = facilitator.displayName;

    const currentExpiry = Date.parse(room.expiresAt);
    const expired =
      !Number.isFinite(currentExpiry) || currentExpiry <= now.getTime();
    if (force || !existed || expired) {
      room.expiresAt = new Date(
        now.getTime() + lifetimeDays * MILLIS_PER_DAY,
      ).toISOString();
    }
  }

  if (deckApplied && seedDeck && !sameDeck(room, seedDeck)) {
    room.deckId = seedDeck.id;
    room.deck = [...seedDeck.cards];
    room.currentRound = {
      id: generateId("r"),
      story: room.currentRound.story,
      status: "voting",
      startedAt: nowIso,
    };
    for (const participant of room.participants.values()) {
      participant.selectedCard = undefined;
    }
  }

  await client.upsertEntity(toEntity(room), "Replace");
  if (facilitatorApplied) {
    await client.upsertEntity(
      {
        partitionKey: MIGRATIONS_PARTITION,
        rowKey: facilitatorMarker,
        appliedAt: nowIso,
        roomCode: code,
        facilitatorName: room.facilitatorName,
      },
      "Replace",
    );
  }
  if (deckApplied && seedDeck && deckMarker) {
    await client.upsertEntity(
      {
        partitionKey: MIGRATIONS_PARTITION,
        rowKey: deckMarker,
        appliedAt: nowIso,
        roomCode: code,
        deckId: seedDeck.id,
      },
      "Replace",
    );
  }

  console.log(
    `[ensure-room] ${existed ? "updated" : "created"} ${code}: ` +
      `facilitator=${room.facilitatorName}` +
      `${facilitatorApplied ? "" : " (kept)"}, ` +
      `deck=${room.deckId}${deckApplied ? " (applied)" : " (kept)"}, ` +
      `expiresAt=${room.expiresAt}`,
  );
}

main().catch((error) => {
  console.error("[ensure-room] failed:", error);
  process.exitCode = 1;
});
