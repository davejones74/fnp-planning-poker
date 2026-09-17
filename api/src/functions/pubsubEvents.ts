import { jsonResponse } from "../shared/http.ts";
import { rooms } from "../services/index.ts";

const SYS_CONNECTED = "azure.webpubsub.sys.connected";
const SYS_DISCONNECTED = "azure.webpubsub.sys.disconnected";

interface CloudEvent {
  type?: unknown;
  data?: { userId?: unknown };
}

/**
 * Azure Web PubSub upstream event handler (hub's event-handler URL template
 * points here). The service validates the handler URL once at setup time
 * (`aeg-event-type: validation`) and afterwards delivers connect/disconnect
 * CloudEvents, which drive participant presence:
 *
 *   - `userId` was set by negotiate to `<roomCode>:<participantId>`, so a
 *     disconnected event marks exactly that participant offline and every
 *     other tab in the room hears `participant.updated`.
 */
export async function pubsubEvents(request: Request): Promise<Response> {
  const eventType = request.headers.get("aeg-event-type") ?? "";

  if (eventType === "validation") {
    const code = await validationCode(request);
    return new Response(code, {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  if (eventType !== "notification") {
    // The service may probe the endpoint with a plain GET/HEAD.
    if (request.method === "GET" || request.method === "HEAD") {
      return new Response("ok", { status: 200 });
    }
    return jsonResponse(400, {
      error: { code: "BAD_EVENT", message: "Unsupported event type." },
    });
  }

  const events = await readCloudEvents(request);
  for (const event of events) {
    const userId = event.data?.userId;
    if (typeof userId !== "string") continue;
    const parsed = parseUserId(userId);
    if (!parsed) continue;
    const { roomCode, participantId } = parsed;
    if (event.type === SYS_DISCONNECTED) {
      await rooms.handleDisconnect(roomCode, participantId);
    } else if (event.type === SYS_CONNECTED) {
      await rooms.handleConnect(roomCode, participantId);
    }
  }
  return jsonResponse(200, {});
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