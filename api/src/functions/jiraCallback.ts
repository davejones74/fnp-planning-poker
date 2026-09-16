import { jira } from "../services/index.ts";
import { consumeOAuthState } from "../services/jira.ts";
import { oauthClosePage } from "./jiraAuthorize.ts";

/**
 * GET /api/jira/callback?code=...&state=...
 * Atlassian redirects here after the user consents. We exchange the code for
 * tokens, then tell the opener (postMessage) that sign-in finished.
 */
export async function jiraCallback(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const state = url.searchParams.get("state") ?? "";
  if (!state || !consumeOAuthState(state)) {
    return oauthClosePage(false, "This sign-in request has expired. Close this window and try again.");
  }

  const error = url.searchParams.get("error_description") ?? url.searchParams.get("error");
  if (error) {
    return oauthClosePage(false, "Sign-in was cancelled. Close this window and try again.");
  }

  const code = url.searchParams.get("code");
  if (!code) {
    return oauthClosePage(false, "No authorisation code was returned. Close this window and try again.");
  }

  try {
    await jira.exchangeAuthorizationCode(code);
    return oauthClosePage(true, "Connected to Jira. This window will close.");
  } catch {
    return oauthClosePage(false, "Sign-in could not be completed. Close this window and try again.");
  }
}