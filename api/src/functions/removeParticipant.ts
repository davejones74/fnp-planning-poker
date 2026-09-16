import { jsonResponse, readJson, roomCodeFromUrl } from "../shared/http.ts";
import { participantIdFromBody } from "../shared/http.ts";
import { rooms } from "../services/index.ts";

interface RemoveParticipantBody {
  participantId?: unknown;
  targetParticipantId?: unknown;
}

export async function removeParticipant(request: Request): Promise<Response> {
  const code = roomCodeFromUrl(request);
  const body = await readJson<RemoveParticipantBody>(request);
  const participantId = participantIdFromBody(body);
  if (typeof body?.targetParticipantId !== "string") {
    return jsonResponse(400, {
      error: { code: "INVALID_REQUEST", message: "targetParticipantId is required." },
    });
  }
  await rooms.removeParticipant(code, participantId, body.targetParticipantId);
  return jsonResponse(200, { ok: true });
}