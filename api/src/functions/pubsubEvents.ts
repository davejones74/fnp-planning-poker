import { jsonResponse } from "../shared/http.ts";
import { rooms } from "../services/index.ts";

const SYS_CONNECTED = "azure.webpubsub.sys.connected";
const SYS_DISCONNECTED = "azure.webpubsub.sys.disconnected";

const PRESENCE: Record<
  string,
  (roomCode: string, participantId: string) => Promise<void>
> = {
  [SYS_CONNECTED]: (roomCode, participantId) => rooms.handleConnect(roomCode, participantId),
  [SYS_DISCONNECTED]: (roomCode, participantId) => rooms.handleDisconnect(roomCode, participantId),
};

/**
 * Azure Web PubSub upstream event handler (the hub's event-handler URL template
 * points here). It drives participant presence:
 *
 *   - `userId` was set by negotiate to `<roomCode>:<participantId>`, so a
 *     disconnect marks exactly that participant offline and every other tab in
 *     the room hears `participant.updated`.
 *
 * Web PubSub delivers events as CloudEvents in *binary* format: the metadata is
 * in `ce-*` request headers (`ce-type`, `ce-userId`) and the body is empty JSON.
 * The service also validates every registered URL with a CloudEvents
 * abuse-protection OPTIONS request, which must answer with
 * `WebHook-Allowed-Origin`; without it no events are ever delivered.
 */
export async function pubsubEvents(request: Request): Promise<Response> {
  // CloudEvents abuse-protection handshake from the Web PubSub service.
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "WebHook-Allowed-Origin": "*",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
    });
  }

  // Event Grid style validation (kept for compatibility; Web PubSub uses the
  // OPTIONS handshake above instead).
  if (request.headers.get("aeg-event-type") === "validation") {
    return new Response(await validationCode(request), {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const ceType = request.headers.get("ce-type");
  if (ceType) {
    const userId = request.headers.get("ce-userid") ?? "";
    await dispatch(ceType, userId);
    return jsonResponse(200, {});
  }

  // Fallback for JSON batch payloads (Event Grid style / tests).
  for (const event of await readCloudEvents(request)) {
    const type = typeof event.type === "string" ? event.type : "";
    const userId = event.data?.userId;
    if (typeof userId === "string") await dispatch(type, userId);
  }
  return jsonResponse(200, {});
}

async function dispatch(type: string, userId: string): Promise<void> {
  const handler = PRESENCE[type];
  if (!handler) return;
  const parsed = parseUserId(userId);
  if (!parsed) return;
  await handler(parsed.roomCode, parsed.participantId);
}

interface CloudEvent {
  type?: unknown;
  data?: { userId?: unknown };
}

async function readCloudEvents(request: Request): Promise<CloudEvent[]> {
  try {
    const raw = JSON.parse(await request.text()) as unknown;
    if (Array.isArray(raw)) return raw as CloudEvent[];
    if (raw && typeof raw === "object") return [raw as CloudEvent];
  } catch {
    // Malformed payloads are ignored; presence is only best-effort.
  }
  return [];
}

async function validationCode(request: Request): Promise<string> {
  const fromQuery = new URL(request.url).searchParams.get("validationCode") ?? "";
  if (fromQuery) return fromQuery;
  try {
    const raw = JSON.parse(await request.text()) as { validationCode?: unknown };
    if (typeof raw.validationCode === "string" && raw.validationCode) {
      return raw.validationCode;
    }
  } catch {
    // fall through
  }
  return "validated";
}

function parseUserId(userId: string): { roomCode: string; participantId: string } | undefined {
  const separator = userId.indexOf(":");
  if (separator <= 0 || separator >= userId.length - 1) return undefined;
  return {
    roomCode: userId.slice(0, separator).toUpperCase(),
    participantId: userId.slice(separator + 1),
  };
}
