export type ApiErrorCode =
  | "INVALID_REQUEST"
  | "INVALID_ROOM_CODE"
  | "ROOM_NOT_FOUND"
  | "ROOM_EXPIRED"
  | "NOT_IN_ROOM"
  | "NOT_FACILITATOR"
  | "INVALID_CARD"
  | "VOTING_CLOSED"
  | "CONFLICT"
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