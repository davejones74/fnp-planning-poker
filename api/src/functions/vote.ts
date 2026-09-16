import {
  jsonResponse,
  participantIdFromBody,
  readJson,
  roomCodeFromUrl,
} from "../shared/http.ts";
import { rooms } from "../services/index.ts";

interface VoteBody {
  participantId?: unknown;
  card?: unknown;
}

export async function vote(request: Request): Promise<Response> {
  const code = roomCodeFromUrl(request);
  const body = await readJson<VoteBody>(request);
  const participantId = participantIdFromBody(body);
  await rooms.selectCard(code, participantId, body?.card);
  return jsonResponse(200, { ok: true });
}