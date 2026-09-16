import type { Room } from "../../../shared/types.ts";

export interface RoomRepository {
  create(room: Room): Promise<void>;
  get(roomCode: string): Promise<Room | undefined>;
  update(room: Room): Promise<void>;
  delete(roomCode: string): Promise<void>;
}