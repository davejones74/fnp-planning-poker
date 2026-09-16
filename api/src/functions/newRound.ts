import { jsonResponse, readJson, roomCodeFromUrl } from "../shared/http.ts";
import { participantIdFromBody } from "../shared/http.ts";
import { rooms } from "../services/index.ts";

export async function newRound(request: Request): Promise<Response> {
  const code = roomCodeFromUrl(request);
  const body = await readJson<Record<string, unknown>>(request);
  const participantId = participantIdFromBody(body);
  const { round } = await rooms.newRound(code, participantId);
  return jsonResponse(200, { ok: true, roundId: round.id });
}