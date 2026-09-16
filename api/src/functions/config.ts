import { jsonResponse } from "../shared/http.ts";
import { configuration } from "../services/index.ts";

/** Client-config values (non-secret) used by the file-import flow. */
export async function clientConfig(): Promise<Response> {
  return jsonResponse(200, {
    jiraHost: configuration.jiraHost ?? null,
    jiraProjectKey: configuration.jiraProjectKey ?? null,
  });
}