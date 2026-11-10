import { TableClient } from "@azure/data-tables";
import { DECKS } from "../shared/decks.ts";
import type { Participant, Room, Round } from "../shared/types.ts";
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

function markerKey(code: string, facilitatorName: string): string {
  const slug = normalize(facilitatorName).replace(/[^a-z0-9]+/g, "-");
  return `${code.toLowerCase()}-${slug}-facilitator`;
}

function createFreshRoom(code: string, facilitatorName: string, now: Date): Room {
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
    deck: [...DECKS.fandp],
    stories: [],
  };
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
  if (!facilitatorName) {
    throw new Error("SEED_FACILITATOR_NAME must not be empty.");
  }
  const lifetimeDays =
    Number.isFinite(extendDays) && extendDays > 0 ? extendDays : 30;

  const marker = markerKey(code, facilitatorName);
  const client = TableClient.fromConnectionString(connectionString, tableName);
  await client.createTable();

  if (!force) {
    try {
      await client.getEntity(MIGRATIONS_PARTITION, marker);
      console.log(
        `[ensure-room] ${code} already seeded (marker ${marker}); nothing to do.`,
      );
      return;
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  }

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
    room = createFreshRoom(code, facilitatorName, now);
  }

  let facilitator = [...room.participants.values()].find(
    (participant) => normalize(participant.displayName) === normalize(facilitatorName),
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
  const expired = !Number.isFinite(currentExpiry) || currentExpiry <= now.getTime();
  const extended = force || !existed || expired;
  if (extended) {
    room.expiresAt = new Date(
      now.getTime() + lifetimeDays * MILLIS_PER_DAY,
    ).toISOString();
  }

  await client.upsertEntity(toEntity(room), "Replace");
  await client.upsertEntity(
    {
      partitionKey: MIGRATIONS_PARTITION,
      rowKey: marker,
      appliedAt: nowIso,
      roomCode: code,
      facilitatorName: facilitator.displayName,
    },
    "Replace",
  );

  console.log(
    `[ensure-room] ${existed ? "updated" : "created"} ${code}: ` +
      `facilitator=${facilitator.displayName}, expiresAt=${room.expiresAt}` +
      `${extended ? " (extended)" : " (expiry kept)"}`,
  );
}

main().catch((error) => {
  console.error("[ensure-room] failed:", error);
  process.exitCode = 1;
});
