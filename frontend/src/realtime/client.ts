import type { RoomEvent } from "../../../shared/types.ts";
import { openSocket, connectMessage, parseSocketMessage } from "./websocket.ts";
import { isRoomEvent } from "./events.ts";

const MAX_RETRY_DELAY = 15_000;
const INITIAL_RETRY_DELAY = 1_000;

export type RealtimeStatus = "connecting" | "open" | "reconnecting" | "closed";

export interface RealtimeClientOptions {
  url: string;
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
  private readonly options: RealtimeClientOptions;

  constructor(options: RealtimeClientOptions) {
    this.options = options;
  }

  join(roomCode: string, participantId: string): void {
    this.roomCode = roomCode;
    this.participantId = participantId;
    this.connect();
  }

  close(): void {
    this.manuallyClosed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.socket?.close();
    this.socket = null;
    this.options.onStatus("closed");
  }

  private connect(): void {
    if (this.manuallyClosed) return;
    this.options.onStatus(this.retryAttempt === 0 ? "connecting" : "reconnecting");

    const ws = openSocket(this.options.url);
    this.socket = ws;

    ws.addEventListener("open", () => {
      this.retryAttempt = 0;
      this.options.onStatus("open");
      this.sendConnect();
    });

    ws.addEventListener("message", (evt) => {
      const parsed = parseSocketMessage(String(evt.data));
      if (isRoomEvent(parsed)) this.options.onEvent(parsed);
    });

    ws.addEventListener("close", () => {
      if (this.manuallyClosed) return;
      const delay = Math.min(INITIAL_RETRY_DELAY * 2 ** this.retryAttempt, MAX_RETRY_DELAY);
      this.retryAttempt++;
      this.retryTimer = setTimeout(() => this.connect(), delay);
    });

    ws.addEventListener("error", () => {
      ws.close();
    });
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