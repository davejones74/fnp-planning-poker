import type { CardValue, Participant, Room, Round } from "../../../shared/types.ts";
import type { RoomRepository } from "./RoomRepository.ts";

interface RoomEntity {
  partitionKey: string;
  rowKey: string;
  roomId: string;
  code: string;
  createdAt: string;
  expiresAt: string;
  facilitatorId: string;
  deck: string;
  currentRound: string;
  participants: string;
  jiraFeedUrl: string;
}

interface TableClientLike {
  createTable(): Promise<void>;
  upsertEntity(entity: object, mode?: "Merge" | "Replace"): Promise<unknown>;
  getEntity<T extends object>(
    partitionKey: string,
    rowKey: string,
  ): Promise<T & { etag: string; rowKey?: string }>;
  deleteEntity(partitionKey: string, rowKey: string): Promise<unknown>;
}

const PARTITION_KEY = "rooms";

export function toEntity(room: Room): RoomEntity {
  return {
    partitionKey: PARTITION_KEY,
    rowKey: room.code,
    roomId: room.id,
    code: room.code,
    createdAt: room.createdAt,
    expiresAt: room.expiresAt,
    facilitatorId: room.facilitatorId,
    deck: JSON.stringify(room.deck),
    currentRound: JSON.stringify(room.currentRound),
    participants: JSON.stringify([...room.participants.values()]),
    jiraFeedUrl: room.jiraFeedUrl ?? "",
  };
}

export function fromEntity(entity: RoomEntity): Room {
  const participants = new Map<string, Participant>();
  for (const participant of JSON.parse(entity.participants) as Participant[]) {
    participants.set(participant.id, participant);
  }
  const room: Room = {
    id: entity.roomId,
    code: entity.code,
    createdAt: entity.createdAt,
    expiresAt: entity.expiresAt,
    facilitatorId: entity.facilitatorId,
    deck: JSON.parse(entity.deck) as CardValue[],
    currentRound: JSON.parse(entity.currentRound) as Round,
    participants,
  };
  if (entity.jiraFeedUrl) room.jiraFeedUrl = entity.jiraFeedUrl;
  return room;
}

/**
 * Persists rooms in an Azure Cosmos DB Table API table. The room is stored as
 * one entity keyed by (rooms, code); nested types (deck, round, participants)
 * are serialised as JSON strings because Table API columns are scalar. Room
 * expiry is enforced by RoomService (which deletes on read) and lazily here as
 * a backstop. The SDK is imported lazily so the local prototype never depends
 * on it; only COSMOS_TABLE_CONNECTION_STRING selects this repository.
 */
export class CosmosTableRoomRepository implements RoomRepository {
  private readonly connectionString: string;
  private tableName: string;
  private clientPromise: Promise<TableClientLike> | null = null;

  constructor(connectionString: string, tableName = "rooms") {
    this.connectionString = connectionString;
    this.tableName = tableName;
  }

  async create(room: Room): Promise<void> {
    const client = await this.table();
    await client.upsertEntity(toEntity(room), "Replace");
  }

  async get(roomCode: string): Promise<Room | undefined> {
    const client = await this.table();
    try {
      const entity = await client.getEntity<RoomEntity>(PARTITION_KEY, roomCode);
      return fromEntity(entity);
    } catch (error) {
      if (!isNotFound(error)) throw error;
      return undefined;
    }
  }

  async update(room: Room): Promise<void> {
    const client = await this.table();
    await client.upsertEntity(toEntity(room), "Replace");
  }

  async delete(roomCode: string): Promise<void> {
    const client = await this.table();
    try {
      await client.deleteEntity(PARTITION_KEY, roomCode);
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  }

  private table(): Promise<TableClientLike> {
    if (!this.clientPromise) {
      this.clientPromise = import("@azure/data-tables").then(
        ({ TableClient }) => {
          const client = TableClient.fromConnectionString(
            this.connectionString,
            this.tableName,
          ) as unknown as TableClientLike;
          return client.createTable().then(() => client);
        },
      );
    }
    return this.clientPromise;
  }
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    (error as { statusCode?: number }).statusCode === 404
  );
}
