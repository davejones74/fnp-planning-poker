import { jsonResponse, readJson, participantIdFromBody, roomCodeFromUrl } from "../shared/http.ts";
import { rooms } from "../services/index.ts";

export async function leaveRoom(request: Request): Promise<Response> {
  const code = roomCodeFromUrl(request);
  const body = await readJson<{ participantId?: unknown }>(request);
  const participantId = participantIdFromBody(body);
  await rooms.leaveRoom(code, participantId);
  return jsonResponse(200, { ok: true });
}