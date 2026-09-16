import { jsonResponse } from "../shared/http.ts";

/**
 * Negotiates the real-time endpoint. In the local prototype this returns a
 * same-origin WebSocket URL; on Azure this returns Web PubSub credentials.
 */
export async function negotiate(request: Request): Promise<Response> {
  const forwardedProto = request.headers.get("x-forwarded-proto") ?? "http";
  const scheme =
    forwardedProto.split(",")[0]?.trim().toLowerCase() === "https" ? "wss" : "ws";
  const host = request.headers.get("host") ?? "localhost:8080";
  return jsonResponse(200, {
    url: `${scheme}://${host}/ws`,
  });
}