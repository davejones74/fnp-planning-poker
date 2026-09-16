import { jsonResponse } from "../shared/http.ts";
import { ApiError } from "../shared/errors.ts";
import { rooms, jira } from "../services/index.ts";

/**
 * GET /api/jira/status?code=<room>&participantId=<id>
 * Returns whether a Jira connection exists and the room's stored feed link.
 * Used by the import dialog to prefill and to detect completed sign-in.
 */
export async function jiraStatus(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const code = (url.searchParams.get("code") ?? "").toUpperCase();
  const participantId = url.searchParams.get("participantId") ?? "";
  if (!code || !code.trim() || !participantId) {
    throw new ApiError("INVALID_REQUEST", 400, "Room code and participant are required.");
  }
  const feedUrl = await rooms.getJiraFeedUrl(code, participantId);
  return jsonResponse(200, { connected: jira.connected, feedUrl });
}