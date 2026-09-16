import type { Room } from "../../../shared/types.ts";
import type { RoomRepository } from "./RoomRepository.ts";

/**
 * Keeps rooms in process memory only. Not persistent: any Function/process
 * restart loses all rooms. Intended for MVP and local development; replace
 * with a durable RoomRepository (e.g. PostgreSQL) when persistence is needed.
 */
export class InMemoryRoomRepository implements RoomRepository {
  private readonly roomsByCode = new Map<string, Room>();
  private readonly roomsById = new Map<string, Room>();

  async create(room: Room): Promise<void> {
    this.roomsByCode.set(room.code, room);
    this.roomsById.set(room.id, room);
  }

  async get(roomCode: string): Promise<Room | undefined> {
    return this.roomsByCode.get(roomCode);
  }

  async update(room: Room): Promise<void> {
    this.roomsByCode.set(room.code, room);
    this.roomsById.set(room.id, room);
  }

  async delete(roomCode: string): Promise<void> {
    const existing = this.roomsByCode.get(roomCode);
    if (existing) this.roomsById.delete(existing.id);
    this.roomsByCode.delete(roomCode);
  }
}