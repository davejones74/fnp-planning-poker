import { jsonResponse, readJson, roomCodeFromUrl } from "../shared/http.ts";
import { rooms } from "../services/index.ts";

interface JoinRoomBody {
  displayName?: unknown;
  participantId?: unknown;
}

export async function joinRoom(request: Request): Promise<Response> {
  const code = roomCodeFromUrl(request);
  const body = await readJson<JoinRoomBody>(request);
  const { room, participant } = await rooms.joinRoom(
    code,
    body?.displayName,
    body?.participantId,
  );
  return jsonResponse(200, {
    roomCode: room.code,
    participantId: participant.id,
    displayName: participant.displayName,
    facilitator: participant.isFacilitator,
  });
}