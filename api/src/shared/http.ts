import { isValidRoomCode } from "../../../shared/validation.ts";
import { ApiError } from "./errors.ts";

/** Extracts and normalises the room code from a /api/rooms/{code}[...] URL. */
export function roomCodeFromUrl(request: Request): string {
  const segments = new URL(request.url).pathname.split("/").filter(Boolean);
  const index = segments.indexOf("rooms");
  const raw = index >= 0 ? segments[index + 1] : undefined;
  const code = (raw ?? "").toUpperCase();
  if (!isValidRoomCode(code)) {
    throw new ApiError(
      "INVALID_ROOM_CODE",
      400,
      "Room code must be exactly 6 characters from the allowed alphabet.",
    );
  }
  return code;
}

/** Extracts and normalises the story key from a /api/rooms/{code}/stories/{key}/... URL. */
export function storyKeyFromUrl(request: Request): string {
  const segments = new URL(request.url).pathname.split("/").filter(Boolean);
  const index = segments.indexOf("rooms");
  const raw = index >= 0 ? segments[index + 3] : undefined;
  const key = (raw ?? "").toUpperCase();
  if (!key) {
    throw new ApiError("INVALID_REQUEST", 400, "Story key is required.");
  }
  return key;
}

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export async function readJson<T>(request: Request): Promise<T> {
  const text = await request.text();
  if (!text.trim()) {
    throw new ApiError("INVALID_REQUEST", 400, "A JSON request body is required.");
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError("INVALID_REQUEST", 400, "Request body must be valid JSON.");
  }
}

export function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ApiError("INVALID_REQUEST", 400, `${field} is required.`);
  }
  return value;
}

export function participantIdFromBody(body: unknown): string {
  if (typeof body !== "object" || body === null) {
    throw new ApiError("INVALID_REQUEST", 400, "participantId is required.");
  }
  return requiredString(
    (body as { participantId?: unknown }).participantId,
    "participantId",
  );
}

export type HttpHandler = (request: Request) => Promise<Response>;

/** Wraps a handler so ApiError becomes a structured JSON error response. */
export function wrap(handler: HttpHandler): HttpHandler {
  return async (request) => {
    try {
      return await handler(request);
    } catch (error) {
      if (error instanceof ApiError) {
        return jsonResponse(error.status, {
          error: { code: error.code, message: error.message },
        });
      }
      console.error("Unhandled error:", error);
      return jsonResponse(500, {
        error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." },
      });
    }
  };
}