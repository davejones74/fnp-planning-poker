import {
  jsonResponse,
  participantIdFromBody,
  readJson,
  roomCodeFromUrl,
} from "../shared/http.ts";
import { rooms } from "../services/index.ts";

interface SwitchDeckBody {
  participantId?: unknown;
  deckId?: unknown;
}

export async function switchDeck(request: Request): Promise<Response> {
  const code = roomCodeFromUrl(request);
  const body = await readJson<SwitchDeckBody>(request);
  const participantId = participantIdFromBody(body);
  const { deck, round } = await rooms.switchDeck(code, participantId, body?.deckId);
  return jsonResponse(200, { ok: true, deckId: deck.id, roundId: round.id });
}
