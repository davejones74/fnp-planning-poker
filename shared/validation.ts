export const ROOM_CODE_LENGTH = 6;
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export const DISPLAY_NAME_MAX = 30;
export const STORY_TITLE_MAX = 100;
export const STORY_DESCRIPTION_MAX = 500;
export const STORY_KEY_MAX = 20;
export const STORY_URL_MAX = 500;
export const MAX_SESSION_STORIES = 200;

/**
 * Hard cap on participants per room. Azure Web PubSub Free_F1 allows 20
 * concurrent connections per resource, so a room can never usefully exceed it.
 */
export const MAX_ROOM_PARTICIPANTS = 20;

export function isValidRoomCode(code: string): boolean {
  if (code.length !== ROOM_CODE_LENGTH) return false;
  for (const char of code) {
    if (!ROOM_CODE_ALPHABET.includes(char)) return false;
  }
  return true;
}

/** Normalises user input into a valid room code, or "" when impossible. */
export function normalizeRoomCode(input: string): string {
  const code = input.trim().toUpperCase();
  if (!isValidRoomCode(code)) return "";
  return code;
}