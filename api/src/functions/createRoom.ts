import { jsonResponse, readJson } from "../shared/http.ts";
import { rooms } from "../services/index.ts";

interface CreateRoomBody {
  displayName?: unknown;
}

export async function createRoom(request: Request): Promise<Response> {
  const body = await readJson<CreateRoomBody>(request);
  const { room, participant } = await rooms.createRoom(body?.displayName);
  return jsonResponse(201, {
    roomCode: room.code,
    participantId: participant.id,
    displayName: participant.displayName,
    facilitator: participant.isFacilitator,
  });
}