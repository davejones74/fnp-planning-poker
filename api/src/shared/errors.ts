export type ApiErrorCode =
  | "INVALID_REQUEST"
  | "INVALID_ROOM_CODE"
  | "ROOM_NOT_FOUND"
  | "ROOM_EXPIRED"
  | "NOT_IN_ROOM"
  | "NOT_FACILITATOR"
  | "ROOM_FULL"
  | "INVALID_CARD"
  | "VOTING_CLOSED"
  | "STORY_NOT_FOUND"
  | "STORY_NOT_ACTIVE"
  | "STORY_ALREADY_ESTIMATED"
  | "CONFLICT"
  | "INVALID_FEED"
  | "JIRA_AUTH_REQUIRED"
  | "JIRA_NOT_CONFIGURED"
  | "JIRA_ERROR"
  | "INTERNAL_ERROR";

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;

  constructor(code: ApiErrorCode, status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

export function internalError(): ApiError {
  return new ApiError("INTERNAL_ERROR", 500, "An unexpected error occurred.");
}