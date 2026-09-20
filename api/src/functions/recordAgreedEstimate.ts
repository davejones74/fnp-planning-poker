import { jsonResponse, readJson, participantIdFromBody } from "../shared/http.ts";
import { roomCodeFromUrl, storyKeyFromUrl } from "../shared/http.ts";
import { rooms } from "../services/index.ts";

interface RecordEstimateBody {
  participantId?: unknown;
  estimate?: unknown;
}

/**
 * POST /api/rooms/{code}/stories/{key}/estimate
 * Body: { participantId, estimate }
 * Facilitator-only. Records the agreed estimate against the story, marks it
 * COMPLETED and starts a fresh (story-free) round.
 */
export async function recordAgreedEstimate(request: Request): Promise<Response> {
  const code = roomCodeFromUrl(request);
  const key = storyKeyFromUrl(request);
  const body = await readJson<RecordEstimateBody>(request);
  const participantId = participantIdFromBody(body);
  const { story } = await rooms.recordAgreedEstimate(code, participantId, key, body?.estimate);
  return jsonResponse(200, { ok: true, story });
}