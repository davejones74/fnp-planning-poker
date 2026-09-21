import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { appState } from "../src/state/app-state.ts";

/**
 * localStorage-backed per-room session identity. Covers the v1 → v2 storage
 * migration: v1 stored the bare participant id, v2 stores
 * {"v":2,"id":"p_…"} under the same key, and legacy bare strings are adopted
 * transparently.
 */
class MemoryStorage implements Storage {
  private store = new Map<string, string>();

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.store.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
}

beforeEach(() => {
  const g = globalThis as {
    localStorage?: unknown;
    document?: { documentElement: HTMLElement };
  };
  g.localStorage = new MemoryStorage();
  g.document = { documentElement: {} as HTMLElement };
});

const KEY = (code: string): string => `scrumPoker.room.${code}`;

describe("appState session storage", () => {
  it("round-trips a v2 session", () => {
    appState.setSession("ABC123", "p_1", "Dave");
    assert.equal(
      localStorage.getItem(KEY("ABC123")),
      JSON.stringify({ v: 2, id: "p_1" }),
    );
    assert.equal(appState.getParticipantId("ABC123"), "p_1");
    assert.deepEqual(appState.getSession("ABC123"), {
      participantId: "p_1",
      displayName: "Dave",
    });
  });

  it("adopts a legacy v1 bare-string session and migrates it to v2", () => {
    localStorage.setItem(KEY("ABC123"), "p_legacy");
    assert.equal(appState.getParticipantId("ABC123"), "p_legacy");
    // The migration rewrites the stored value to the versioned shape.
    assert.equal(
      localStorage.getItem(KEY("ABC123")),
      JSON.stringify({ v: 2, id: "p_legacy" }),
    );
    assert.deepEqual(appState.getSession("ABC123").participantId, "p_legacy");
  });

  it("returns null for a malformed versioned payload", () => {
    localStorage.setItem(KEY("ABC123"), "{not json");
    assert.equal(appState.getParticipantId("ABC123"), null);
  });

  it("returns null (and leaves storage intact) for a future schema", () => {
    localStorage.setItem(KEY("ABC123"), JSON.stringify({ v: 3, id: "p_future" }));
    assert.equal(appState.getParticipantId("ABC123"), null);
    // A newer client's payload is never clobbered by an older one.
    assert.equal(
      localStorage.getItem(KEY("ABC123")),
      JSON.stringify({ v: 3, id: "p_future" }),
    );
  });

  it("does not adopt arbitrary legacy values when the session is valid", () => {
    appState.setSession("ABC123", "p_1", "Dave");
    assert.equal(appState.getParticipantId("ABC123"), "p_1");
  });

  it("stores per-room identities independently", () => {
    appState.setSession("ABC123", "p_1", "Dave");
    appState.setSession("XYZ789", "p_2", "Rachael");
    assert.equal(appState.getParticipantId("ABC123"), "p_1");
    assert.equal(appState.getParticipantId("XYZ789"), "p_2");
  });

  it("clears a room session without touching other rooms", () => {
    appState.setSession("ABC123", "p_1", "Dave");
    appState.setSession("XYZ789", "p_2", "Rachael");
    appState.clearSession("ABC123");
    assert.equal(appState.getParticipantId("ABC123"), null);
    assert.equal(appState.getParticipantId("XYZ789"), "p_2");
  });
});