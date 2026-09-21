const DISPLAY_NAME_KEY = "scrumPoker.displayName";
const RECENT_ROOMS_KEY = "scrumPoker.recentRooms";
const ROOM_PREFIX = "scrumPoker.room.";
const THEME_KEY = "scrumPoker.theme";

export type Theme = "light" | "dark";

/**
 * Version of the per-room session payload stored in localStorage.
 *
 *   v1 (legacy): the bare participant id string ("scrumPoker.room.ABC123" = "p_…").
 *   v2: JSON {"v":2,"id":"p_…"} under the same key.
 *
 * The serializer keeps the storage key stable so existing v1 sessions keep
 * working; the reader adopts any legacy bare string as v2 automatically.
 */
const ROOM_SESSION_VERSION = 2;

function safeGet(storage: Storage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(storage: Storage, key: string, value: string): void {
  try {
    storage.setItem(key, value);
  } catch {
    // Storage disabled / quota exceeded: convenience only, never critical.
  }
}

function safeRemove(storage: Storage, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    // ignore
  }
}

export interface SessionIdentity {
  participantId: string;
  displayName: string;
}

/** Reads a room session payload, adopting legacy v1 (bare string) as v2. */
function parseRoomSession(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as { v?: unknown; id?: unknown };
      if (parsed.v === ROOM_SESSION_VERSION && typeof parsed.id === "string") {
        return parsed.id;
      }
      // Unknown future schema: treat as no session rather than corrupting a
      // newer client's data.
      return null;
    } catch {
      return null;
    }
  }
  return trimmed;
}

function serializeRoomSession(participantId: string): string {
  return JSON.stringify({ v: ROOM_SESSION_VERSION, id: participantId });
}

export const appState = {
  get displayName(): string {
    return safeGet(localStorage, DISPLAY_NAME_KEY) ?? "";
  },

  set displayName(value: string) {
    safeSet(localStorage, DISPLAY_NAME_KEY, value);
  },

  get theme(): Theme {
    return safeGet(localStorage, THEME_KEY) === "dark" ? "dark" : "light";
  },

  set theme(value: Theme) {
    safeSet(localStorage, THEME_KEY, value);
    document.documentElement.dataset.theme = value;
  },

  /** Participant id previously used by this browser for a room, if any. */
  getParticipantId(roomCode: string): string | null {
    const id = parseRoomSession(safeGet(localStorage, ROOM_PREFIX + roomCode));
    if (!id) return null;
    // Adopt legacy v1 (bare string) sessions as the versioned payload so a
    // future schema bump starts from a known shape.
    const raw = safeGet(localStorage, ROOM_PREFIX + roomCode);
    if (raw !== null && !raw.trim().startsWith("{")) {
      safeSet(localStorage, ROOM_PREFIX + roomCode, serializeRoomSession(id));
    }
    return id;
  },

  /**
   * Participant identity for a room. Stored in localStorage (not session) so a
   * rejoin from another tab or after a browser restart resumes the same
   * participant instead of creating a duplicate.
   */
  getSession(roomCode: string): SessionIdentity | null {
    const participantId = this.getParticipantId(roomCode);
    if (!participantId) return null;
    return { participantId, displayName: this.displayName };
  },

  setSession(roomCode: string, participantId: string, displayName: string): void {
    safeSet(localStorage, ROOM_PREFIX + roomCode, serializeRoomSession(participantId));
    this.displayName = displayName;
    this.addRecentRoom(roomCode);
  },

  clearSession(roomCode: string): void {
    safeRemove(localStorage, ROOM_PREFIX + roomCode);
  },

  getRecentRooms(): string[] {
    const raw = safeGet(localStorage, RECENT_ROOMS_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed)
        ? parsed.filter((x): x is string => typeof x === "string")
        : [];
    } catch {
      return [];
    }
  },

  addRecentRoom(roomCode: string): void {
    const next = [roomCode, ...this.getRecentRooms().filter((c) => c !== roomCode)].slice(0, 5);
    safeSet(localStorage, RECENT_ROOMS_KEY, JSON.stringify(next));
  },

  removeRecentRoom(roomCode: string): void {
    safeSet(
      localStorage,
      RECENT_ROOMS_KEY,
      JSON.stringify(this.getRecentRooms().filter((c) => c !== roomCode)),
    );
  },

  clearRecentRooms(): void {
    safeRemove(localStorage, RECENT_ROOMS_KEY);
  },
};