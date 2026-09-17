import type { RoomEvent } from "../../../shared/types.ts";
import type { PubSubService } from "./PubSubService.ts";

interface WebPubSubGroupLike {
  sendToAll(message: unknown): Promise<void>;
}

interface WebPubSubClientLike {
  group(groupName: string): WebPubSubGroupLike;
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