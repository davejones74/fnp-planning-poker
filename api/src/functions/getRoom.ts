import { jsonResponse, roomCodeFromUrl } from "../shared/http.ts";
import { rooms } from "../services/index.ts";

export async function getRoom(request: Request): Promise<Response> {
  const code = roomCodeFromUrl(request);
  const viewerId = new URL(request.url).searchParams.get("participantId") ?? undefined;
  const room = await rooms.getRoom(code, viewerId);
  return jsonResponse(200, room);
}