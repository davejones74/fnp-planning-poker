import { jsonResponse, readJson, participantIdFromBody, roomCodeFromUrl } from "../shared/http.ts";
import { rooms } from "../services/index.ts";

export async function presence(request: Request): Promise<Response> {
  const code = roomCodeFromUrl(request);
  const body = await readJson<{ participantId?: unknown }>(request);
  const participantId = participantIdFromBody(body);
  await rooms.touchParticipant(code, participantId);
  return jsonResponse(200, { ok: true });
}