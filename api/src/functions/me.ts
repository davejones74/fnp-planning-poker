import { jsonResponse } from "../shared/http.ts";

/**
 * Reports the caller's identity (when authenticated later) and admin flag.
 * Phase 1 has no authentication, so this is always anonymous. Structured so a
 * real auth provider can be added without redesigning the app.
 */
export async function me(_request: Request): Promise<Response> {
  return jsonResponse(200, {
    authenticated: false,
    isAdmin: false,
    identity: null,
  });
}