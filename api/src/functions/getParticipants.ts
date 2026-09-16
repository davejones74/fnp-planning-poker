import { jsonResponse, roomCodeFromUrl } from "../shared/http.ts";
import { rooms } from "../services/index.ts";

export async function getParticipants(request: Request): Promise<Response> {
  const code = roomCodeFromUrl(request);
  const participants = await rooms.getParticipants(code);
  return jsonResponse(200, { participants });
}