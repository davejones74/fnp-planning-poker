import { jsonResponse } from "../shared/http.ts";

export async function health(): Promise<Response> {
  return jsonResponse(200, { status: "ok" });
}