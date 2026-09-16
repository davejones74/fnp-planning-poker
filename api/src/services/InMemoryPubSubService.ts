import { WebSocket } from "ws";
import type { RoomEvent } from "../../../shared/types.ts";
import type { PubSubService } from "./PubSubService.ts";

interface Binding {
  roomCode: string;
  participantId: string;
}

/**
 * Local in-memory replacement for Azure Web PubSub used by the prototype.
 * Mimics the group model: each room is one group, events are broadcast only
 * to sockets bound to that room. Swap for a Web PubSub-based implementation
 * in Phase 2 without changing room/domain logic.
 */
export class InMemoryPubSubService implements PubSubService {
  private readonly roomSockets = new Map<string, Set<WebSocket>>();
  private readonly socketBinding = new Map<WebSocket, Binding>();

  bind(socket: WebSocket, roomCode: string, participantId: string): void {
    const existing = this.socketBinding.get(socket);
    if (existing) this.unbind(socket);
    let sockets = this.roomSockets.get(roomCode);
    if (!sockets) {
      sockets = new Set();
      this.roomSockets.set(roomCode, sockets);
    }
    sockets.add(socket);
    this.socketBinding.set(socket, { roomCode, participantId });
  }

  unbind(socket: WebSocket): Binding | undefined {
    const binding = this.socketBinding.get(socket);
    if (!binding) return undefined;
    const sockets = this.roomSockets.get(binding.roomCode);
    if (sockets) {
      sockets.delete(socket);
      if (sockets.size === 0) this.roomSockets.delete(binding.roomCode);
    }
    this.socketBinding.delete(socket);
    return binding;
  }

  publishToRoom(roomCode: string, event: RoomEvent): void {
    const sockets = this.roomSockets.get(roomCode);
    if (!sockets) return;
    const payload = JSON.stringify(event);
    for (const socket of sockets) {
      if (socket.readyState === WebSocket.OPEN) socket.send(payload);
    }
  }
}