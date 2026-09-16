import { jsonResponse, readJson, roomCodeFromUrl } from "../shared/http.ts";
import { participantIdFromBody } from "../shared/http.ts";
import { rooms } from "../services/index.ts";

export async function reveal(request: Request): Promise<Response> {
  const code = roomCodeFromUrl(request);
  const body = await readJson<Record<string, unknown>>(request);
  const participantId = participantIdFromBody(body);
  await rooms.revealCards(code, participantId);
  return jsonResponse(200, { ok: true });
}