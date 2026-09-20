import { jsonResponse, readJson, participantIdFromBody } from "../shared/http.ts";
import { roomCodeFromUrl } from "../shared/http.ts";
import { rooms } from "../services/index.ts";

interface DismissStoriesBody {
  participantId?: unknown;
  keys?: unknown;
}

/**
 * POST /api/rooms/{code}/stories/dismiss
 * Body: { participantId, keys: string[] }
 * Facilitator-only. Removes the selected completed stories from the backlog.
 */
export async function dismissStories(request: Request): Promise<Response> {
  const code = roomCodeFromUrl(request);
  const body = await readJson<DismissStoriesBody>(request);
  const participantId = participantIdFromBody(body);
  const { dismissed, skipped } = await rooms.dismissStories(
    code,
    participantId,
    body?.keys,
  );
  return jsonResponse(200, { ok: true, dismissed, skipped });
}