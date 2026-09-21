import type { PublicRoom, SessionStory } from "../../../shared/types.ts";
import { appState } from "../state/app-state.ts";

export class ApiClientError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = "ApiClientError";
    this.code = code;
    this.status = status;
  }
}

export async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      headers: { "content-type": "application/json" },
      ...options,
    });
  } catch {
    throw new ApiClientError("NETWORK_ERROR", 0, "Cannot reach the server.");
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const body = data as { error?: { code?: string; message?: string } } | null;
    throw new ApiClientError(
      body?.error?.code ?? "UNKNOWN",
      res.status,
      body?.error?.message ?? res.statusText,
    );
  }
  return data as T;
}

export interface CreatedRoom {
  roomCode: string;
  participantId: string;
  displayName: string;
  facilitator: boolean;
}

export interface StoryPayload {
  title: string;
  description: string;
  key?: string;
  url?: string;
}

export interface ImportSummary {
  ok: boolean;
  imported: number;
  duplicatesSkipped: number;
  invalidSkipped: number;
  limitSkipped: number;
  stories: SessionStory[];
}

export interface NegotiateResult {
  url: string;
  /** Present when the server negotiated an Azure Web PubSub endpoint. */
  protocol?: "json.webpubsub.azure.v1";
  /** The room group to join when protocol is the Azure subprotocol. */
  group?: string;
}

export const roomsApi = {
  create(displayName: string): Promise<CreatedRoom> {
    return request<CreatedRoom>("/api/rooms", {
      method: "POST",
      body: JSON.stringify({ displayName }),
    });
  },

  join(
    code: string,
    displayName: string,
    participantId?: string,
  ): Promise<CreatedRoom> {
    return request<CreatedRoom>(`/api/rooms/${code}/join`, {
      method: "POST",
      body: JSON.stringify({ displayName, participantId }),
    });
  },

  get(code: string, participantId?: string): Promise<PublicRoom> {
    const query = participantId
      ? `?participantId=${encodeURIComponent(participantId)}`
      : "";
    return request<PublicRoom>(`/api/rooms/${code}${query}`);
  },

  vote(code: string, card: string): Promise<{ ok: boolean }> {
    const participantId = sessionParticipantId(code);
    return request<{ ok: boolean }>(`/api/rooms/${code}/vote`, {
      method: "POST",
      body: JSON.stringify({ participantId, card }),
    });
  },

  reveal(code: string): Promise<{ ok: boolean }> {
    const participantId = sessionParticipantId(code);
    return request<{ ok: boolean }>(`/api/rooms/${code}/reveal`, {
      method: "POST",
      body: JSON.stringify({ participantId }),
    });
  },

  newRound(code: string): Promise<{ ok: boolean; roundId: string }> {
    const participantId = sessionParticipantId(code);
    return request<{ ok: boolean; roundId: string }>(`/api/rooms/${code}/round`, {
      method: "POST",
      body: JSON.stringify({ participantId }),
    });
  },

  updateStory(code: string, story: StoryPayload): Promise<{ ok: boolean; story: StoryPayload }> {
    const participantId = sessionParticipantId(code);
    return request<{ ok: boolean; story: StoryPayload }>(`/api/rooms/${code}/story`, {
      method: "PUT",
      body: JSON.stringify({ participantId, ...story }),
    });
  },

  importStories(code: string, stories: StoryPayload[]): Promise<ImportSummary> {
    const participantId = sessionParticipantId(code);
    return request<ImportSummary>(`/api/rooms/${code}/stories/import`, {
      method: "POST",
      body: JSON.stringify({ participantId, stories }),
    });
  },

  startStoryEstimation(code: string, key: string): Promise<{ ok: boolean; story: SessionStory }> {
    const participantId = sessionParticipantId(code);
    return request<{ ok: boolean; story: SessionStory }>(
      `/api/rooms/${code}/stories/${encodeURIComponent(key)}/start`,
      {
        method: "POST",
        body: JSON.stringify({ participantId }),
      },
    );
  },

  recordAgreedEstimate(
    code: string,
    key: string,
    estimate: string,
  ): Promise<{ ok: boolean; story: SessionStory }> {
    const participantId = sessionParticipantId(code);
    return request<{ ok: boolean; story: SessionStory }>(
      `/api/rooms/${code}/stories/${encodeURIComponent(key)}/estimate`,
      {
        method: "POST",
        body: JSON.stringify({ participantId, estimate }),
      },
    );
  },

  dismissStories(
    code: string,
    keys: string[],
  ): Promise<{ ok: boolean; dismissed: number; skipped: number }> {
    const participantId = sessionParticipantId(code);
    return request<{ ok: boolean; dismissed: number; skipped: number }>(
      `/api/rooms/${code}/stories/dismiss`,
      {
        method: "POST",
        body: JSON.stringify({ participantId, keys }),
      },
    );
  },

  removeParticipant(code: string, targetParticipantId: string): Promise<{ ok: boolean }> {
    const participantId = sessionParticipantId(code);
    return request<{ ok: boolean }>(`/api/rooms/${code}/participants/remove`, {
      method: "POST",
      body: JSON.stringify({ participantId, targetParticipantId }),
    });
  },

  /** Leaves the room: the participant's id stops being reusable for it. */
  leave(code: string): Promise<{ ok: boolean }> {
    const participantId = sessionParticipantId(code);
    return request<{ ok: boolean }>(`/api/rooms/${code}/participants/leave`, {
      method: "POST",
      body: JSON.stringify({ participantId }),
    });
  },

  /**
   * Presence heartbeat: proves this browser tab is still really in the room.
   * Web PubSub disconnect events can be lost (a closed tab can linger marked
   * online), so the server's stale-sweep keys off this live ping instead.
   */
  presence(code: string): Promise<{ ok: boolean }> {
    const participantId = sessionParticipantId(code);
    return request<{ ok: boolean }>(
      `/api/rooms/${code}/participants/presence`,
      {
        method: "POST",
        body: JSON.stringify({ participantId }),
      },
    );
  },

  negotiate(code: string, participantId: string): Promise<NegotiateResult> {
    const query = new URLSearchParams({ roomCode: code, participantId });
    return request<NegotiateResult>(`/api/negotiate?${query.toString()}`);
  },
};

/**
 * participantId is carried by the caller in the app; the API layer reads the
 * session identity for the given room so callers do not repeat themselves.
 * Reads through appState so both legacy (v1 bare string) and versioned (v2
 * JSON) localStorage payloads resolve to the same participant id.
 */
function sessionParticipantId(code: string): string {
  const participantId = appState.getParticipantId(code);
  if (!participantId) {
    throw new ApiClientError("NOT_IN_ROOM", 401, "You are not in this room.");
  }
  return participantId;
}