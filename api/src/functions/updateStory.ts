import { jsonResponse, readJson, roomCodeFromUrl } from "../shared/http.ts";
import { participantIdFromBody } from "../shared/http.ts";
import { rooms } from "../services/index.ts";

interface UpdateStoryBody {
  participantId?: unknown;
  title?: unknown;
  description?: unknown;
}

export async function updateStory(request: Request): Promise<Response> {
  const code = roomCodeFromUrl(request);
  const body = await readJson<UpdateStoryBody>(request);
  const participantId = participantIdFromBody(body);
  const story = await rooms.updateStory(code, participantId, {
    title: body?.title,
    description: body?.description,
  });
  return jsonResponse(200, { ok: true, story });
}