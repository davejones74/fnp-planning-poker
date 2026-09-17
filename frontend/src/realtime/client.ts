import type { RoomEvent } from "../../../shared/types.ts";
import {
  PUBSUB_SUBPROTOCOL,
  connectMessage,
  openSocket,
  parsePubSubEnvelope,
  parseSocketMessage,
} from "./websocket.ts";
import { isRoomEvent } from "./events.ts";

const MAX_RETRY_DELAY = 15_000;
const INITIAL_RETRY_DELAY = 1_000;
const PING_INTERVAL_MS = 30_000;

export type RealtimeStatus = "connecting" | "open" | "reconnecting" | "closed";

export interface RealtimeClientOptions {
  url: string;
  /** Present when the endpoint speaks the Azure Web PubSub json subprotocol. */
  protocol?: "json.webpubsub.azure.v1";
  /** Room group to join; only used with the Azure subprotocol. */
  group?: string;
  /**
   * Fetches a fresh endpoint URL. Azure access tokens expire, so reconnects
   * renegotiate to stay authenticated. Ignored in local (non-Azure) mode.
   */
  renegotiate?: () => Promise<string>;
  onEvent(event: RoomEvent): void;
  onStatus(status: RealtimeStatus): void;
}

export class RealtimeClient {
  private socket: WebSocket | null = null;
  private retryAttempt = 0;
  private roomCode: string | null = null;
  private participantId: string | null = null;
  private manuallyClosed = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private url: string;
  private readonly options: RealtimeClientOptions;

  constructor(options: RealtimeClientOptions) {
    this.options = options;
    this.url = options.url;
  }

  join(roomCode: string, participantId: string): void {
    this.roomCode = roomCode;
    this.participantId = participantId;
    this.connect();
  }

  close(): void {
    this.manuallyClosed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.stopPing();
    this.socket?.close();
    this.socket = null;
    this.options.onStatus("closed");
  }

  private isAzure(): boolean {
    return this.options.protocol === PUBSUB_SUBPROTOCOL;
  }

  private connect(): void {
    if (this.manuallyClosed) return;
    this.options.onStatus(this.retryAttempt === 0 ? "connecting" : "reconnecting");

    const open = (): void => {
      if (this.manuallyClosed) return;
      const ws = openSocket(
        this.url,
        this.isAzure() ? PUBSUB_SUBPROTOCOL : undefined,
      );
      this.socket = ws;

      ws.addEventListener("open", () => this.onOpen(ws));
      ws.addEventListener("message", (evt) => this.onMessage(evt));
      ws.addEventListener("close", () => this.onClose());
      ws.addEventListener("error", () => ws.close());
    };

    // Azure tokens expire; refresh the endpoint before reconnecting.
    if (this.isAzure() && this.retryAttempt > 0 && this.options.renegotiate) {
      this.options
        .renegotiate()
        .then((url) => {
          this.url = url;
          open();
        })
        .catch(() => open());
    } else {
      open();
    }
  }

  private onOpen(ws: WebSocket): void {
    this.retryAttempt = 0;
    this.options.onStatus("open");

    if (this.isAzure()) {
      // The negotiation token pre-joins the room group; joining again keeps
      // membership explicit and matches the frontend's contract with the API.
      if (this.options.group) {
        ws.send(JSON.stringify({ type: "joinGroup", group: this.options.group }));
      }
      this.pingTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "ping" }));
        }
      }, PING_INTERVAL_MS);
    } else {
      this.sendConnect();
    }
  }

  private onMessage(evt: MessageEvent): void {
    const data = String(evt.data);
    const parsed = this.isAzure() ? parsePubSubEnvelope(data) : parseSocketMessage(data);
    if (isRoomEvent(parsed)) this.options.onEvent(parsed);
  }

  private onClose(): void {
    if (this.manuallyClosed) return;
    this.stopPing();
    const delay = Math.min(INITIAL_RETRY_DELAY * 2 ** this.retryAttempt, MAX_RETRY_DELAY);
    this.retryAttempt++;
    this.retryTimer = setTimeout(() => this.connect(), delay);
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private sendConnect(): void {
    if (
      this.socket?.readyState === WebSocket.OPEN &&
      this.roomCode &&
      this.participantId
    ) {
      this.socket.send(
        JSON.stringify(connectMessage(this.roomCode, this.participantId)),
      );
    }
  }
}