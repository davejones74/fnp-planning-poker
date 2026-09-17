import type { RoomEvent } from "../../../shared/types.ts";
import type { PubSubService } from "./PubSubService.ts";

interface WebPubSubGroupLike {
  sendToAll(message: unknown): Promise<void>;
}

interface WebPubSubClientLike {
  group(groupName: string): WebPubSubGroupLike;
  closeUserConnections(userId: string): Promise<void>;
}

/**
 * Broadcasts room events to the Azure Web PubSub group named after the room
 * code. The SDK is imported lazily so the local prototype never depends on it.
 */
export class WebPubSubPubSubService implements PubSubService {
  private readonly connectionString: string;
  private readonly hub: string;
  private clientPromise: Promise<WebPubSubClientLike> | null = null;

  constructor(connectionString: string, hub: string) {
    this.connectionString = connectionString;
    this.hub = hub;
  }

  publishToRoom(roomCode: string, event: RoomEvent): void {
    void this.send(roomCode, event);
  }

  disconnectParticipant(roomCode: string, participantId: string): void {
    void this.closeUser(roomCode, participantId);
  }

  private async closeUser(roomCode: string, participantId: string): Promise<void> {
    try {
      const client = await this.client();
      // negotiate() set userId to "<roomCode>:<participantId>".
      await client.closeUserConnections(`${roomCode}:${participantId}`);
    } catch (error) {
      // A participant with no live connections 404s; that is a no-op for us.
      console.error("Web PubSub closeUserConnections failed:", error);
    }
  }

  private async send(roomCode: string, event: RoomEvent): Promise<void> {
    try {
      const client = await this.client();
      await client.group(roomCode).sendToAll(event);
    } catch (error) {
      // Presence/publish failures must not break the HTTP request that caused
      // the event; the rooms table already holds the source of truth.
      console.error("Web PubSub publish failed:", error);
    }
  }

  private client(): Promise<WebPubSubClientLike> {
    if (!this.clientPromise) {
      this.clientPromise = import("@azure/web-pubsub").then(
        ({ WebPubSubServiceClient }) => {
          const service = new WebPubSubServiceClient(
            this.connectionString,
            this.hub,
          );
          return service as unknown as WebPubSubClientLike;
        },
      );
    }
    return this.clientPromise;
  }
}