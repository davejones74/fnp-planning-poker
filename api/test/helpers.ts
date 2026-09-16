import type { RoomEvent } from "../../shared/types.ts";
import { InMemoryRoomRepository } from "../src/services/InMemoryRoomRepository.ts";
import { RoomService } from "../src/services/RoomService.ts";

export class FakeClock {
  private current: Date;

  constructor(iso = "2026-01-01T00:00:00.000Z") {
    this.current = new Date(iso);
  }

  now(): Date {
    return new Date(this.current);
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

export class FakePubSub {
  events: Array<{ roomCode: string; event: RoomEvent }> = [];

  publishToRoom(roomCode: string, event: RoomEvent): void {
    this.events.push({ roomCode, event });
  }

  forRoom(roomCode: string): Array<{ roomCode: string; event: RoomEvent }> {
    return this.events.filter((e) => e.roomCode === roomCode);
  }

  clear(): void {
    this.events = [];
  }
}

export interface Harness {
  clock: FakeClock;
  repository: InMemoryRoomRepository;
  pubsub: FakePubSub;
  service: RoomService;
}

export function makeHarness(clock: FakeClock = new FakeClock()): Harness {
  const repository = new InMemoryRoomRepository();
  const pubsub = new FakePubSub();
  const service = new RoomService(repository, pubsub, {}, () => clock.now());
  return { clock, repository, pubsub, service };
}

/** Creates a room plus a second participant; returns both identities. */
export async function roomWithTwo(
  h: Harness,
  owner = "Dave",
  joiner = "Alice",
): Promise<{
  code: string;
  facilitatorId: string;
  joinerId: string;
  joinerName: string;
}> {
  const { room, participant } = await h.service.createRoom(owner);
  const joined = await h.service.joinRoom(room.code, joiner);
  return {
    code: room.code,
    facilitatorId: participant.id,
    joinerId: joined.participant.id,
    joinerName: joiner,
  };
}