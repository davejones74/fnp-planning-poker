import { jsonResponse, readJson, participantIdFromBody } from "../shared/http.ts";
import { roomCodeFromUrl, storyKeyFromUrl } from "../shared/http.ts";
import { rooms } from "../services/index.ts";

interface StartStoryBody {
  participantId?: unknown;
}

/**
 * POST /api/rooms/{code}/stories/{key}/start
 * Body: { participantId }
 * Facilitator-only. Marks the story as ESTIMATING and starts a new estimation
 * round associated with it.
 */
export async function startStoryEstimation(request: Request): Promise<Response> {
  const code = roomCodeFromUrl(request);
  const key = storyKeyFromUrl(request);
  const body = await readJson<StartStoryBody>(request);
  const participantId = participantIdFromBody(body);
  const { story } = await rooms.startStoryEstimation(code, participantId, key);
  return jsonResponse(200, { ok: true, story });
}