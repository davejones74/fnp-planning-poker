import { jsonResponse } from "../shared/http.ts";
import { jira } from "../services/index.ts";
import { createOAuthState } from "../services/jira.ts";

export function oauthClosePage(ok: boolean, message: string): Response {
  const html = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Jira sign-in</title></head>
  <body style="font-family:system-ui,sans-serif;padding:40px;text-align:center;color:#1f2933;">
    <p>${message}</p>
    <script>
      (function () {
        var msg = { type: "jira-authorized", ok: ${ok ? "true" : "false"} };
        if (window.opener) {
          try { window.opener.postMessage(msg, location.origin); } catch (e) {}
          window.close();
        } else {
          document.documentElement.textContent = "You can close this window and try the import again.";
        }
      })();
    </script>
  </body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

/**
 * GET /api/jira/authorize?room=<code>&returnTo=<url>
 * Opens a popup that redirects to the Atlassian consent screen. The callback
 * reports success back to this window via postMessage.
 */
export async function jiraAuthorize(request: Request): Promise<Response> {
  if (!jira.isConfigured && !jira.isMock) {
    return jsonResponse(503, {
      error: {
        code: "JIRA_NOT_CONFIGURED",
        message: "Jira is not configured. Set JIRA_CLIENT_ID and JIRA_CLIENT_SECRET.",
      },
    });
  }
  const url = new URL(request.url);
  const room = (url.searchParams.get("room") ?? "").toUpperCase();
  const returnTo = url.searchParams.get("returnTo") ?? "/";

  if (jira.isMock) {
    return oauthClosePage(true, "Mock Jira linked. This window will close.");
  }

  const state = createOAuthState(room, returnTo);
  return Response.redirect(jira.buildAuthorizeUrl(state), 302);
}