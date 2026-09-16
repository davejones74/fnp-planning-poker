import { jsonResponse, readJson, requiredString } from "../shared/http.ts";
import { ApiError } from "../shared/errors.ts";
import { rooms, jira } from "../services/index.ts";
import { parseFeedUrl } from "../services/jira.ts";
import { isValidRoomCode } from "../../../shared/validation.ts";

interface JiraFeedBody {
  roomCode?: unknown;
  participantId?: unknown;
  feedUrl?: unknown;
}

/**
 * POST /api/jira/feed
 * Body: { roomCode, participantId, feedUrl? }
 * Facilitator-only. Returns the stories from the Jira link (or reuses the
 * room's last-used link when feedUrl is omitted) and remembers the link.
 */
export async function jiraFeed(request: Request): Promise<Response> {
  const body = await readJson<JiraFeedBody>(request);
  const roomCode = (typeof body.roomCode === "string" ? body.roomCode : "").toUpperCase();
  const participantId = requiredString(body.participantId, "participantId");
  if (!isValidRoomCode(roomCode)) {
    throw new ApiError(
      "INVALID_ROOM_CODE",
      400,
      "Room code must be exactly 6 characters from the allowed alphabet.",
    );
  }

  await rooms.assertFacilitator(roomCode, participantId);

  const provided =
    typeof body.feedUrl === "string" && body.feedUrl.trim() ? body.feedUrl.trim() : null;
  const link = provided ?? (await rooms.getJiraFeedUrl(roomCode, participantId));
  const query = parseFeedUrl(link);

  const stories = await jira.fetchStories(query);
  if (provided) {
    await rooms.setJiraFeedUrl(roomCode, participantId, provided);
  }
  return jsonResponse(200, { ok: true, stories, feedUrl: provided ?? link });
}