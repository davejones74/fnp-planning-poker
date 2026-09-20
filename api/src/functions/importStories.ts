import { jsonResponse, readJson, participantIdFromBody } from "../shared/http.ts";
import { roomCodeFromUrl } from "../shared/http.ts";
import { rooms } from "../services/index.ts";

interface ImportStoriesBody {
  participantId?: unknown;
  stories?: unknown;
}

/**
 * POST /api/rooms/{code}/stories/import
 * Body: { participantId, stories: [{ key, title, description?, url? }] }
 * Facilitator-only. Adds parsed Jira/manual stories to the session backlog
 * (upserting by key) and returns an import summary for the facilitator.
 */
export async function importStories(request: Request): Promise<Response> {
  const code = roomCodeFromUrl(request);
  const body = await readJson<ImportStoriesBody>(request);
  const participantId = participantIdFromBody(body);
  const summary = await rooms.importStories(code, participantId, body);
  return jsonResponse(200, { ok: true, ...summary });
}