const DISPLAY_NAME_KEY = "scrumPoker.displayName";
const RECENT_ROOMS_KEY = "scrumPoker.recentRooms";
const ROOM_PREFIX = "scrumPoker.room.";
const THEME_KEY = "scrumPoker.theme";

export type Theme = "light" | "dark";

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
    return safeGet(localStorage, ROOM_PREFIX + roomCode);
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
    safeSet(localStorage, ROOM_PREFIX + roomCode, participantId);
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