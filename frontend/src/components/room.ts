import { roomsApi, ApiClientError } from "../api/rooms.ts";
import { appState, type SessionIdentity } from "../state/app-state.ts";
import { RoomState } from "../state/room-state.ts";
import { RealtimeClient } from "../realtime/client.ts";
import { renderEstimationDeck } from "./estimation-deck.ts";
import { renderPlayersPanel, updateTimers } from "./players-panel.ts";
import { renderStoryPanel } from "./story-panel.ts";
import { navigate, el, clear, showToast, inputValue } from "./dom.ts";
import { firstName } from "../util/display.ts";
import { normalizeRoomCode } from "../../../shared/validation.ts";
import type { PublicRoom } from "../../../shared/types.ts";

let activeClient: RealtimeClient | null = null;
let activeTimer: ReturnType<typeof setInterval> | null = null;
let playersRootRef: HTMLElement | null = null;

export async function renderRoomPage(
  root: HTMLElement,
  rawCode: string,
): Promise<void> {
  teardownRoom();

  const code = normalizeRoomCode(rawCode);
  if (!code) {
    root.append(
      el("div", { class: "panel" }, el("p", { text: "Invalid room code in URL." })),
      el(
        "button",
        { class: "ghost", text: "← Home" },
      ),
    );
    root.querySelector("button")?.addEventListener("click", () => navigate("/"));
    return;
  }

  const resume = appState.getSession(code);

  // Try to resume an existing session.
  if (resume) {
    try {
      const room = await roomsApi.get(code, resume.participantId);
      const participant = room.participants.find((p) => p.id === resume.participantId);
      if (participant) {
        await enterRoom(root, code, resume, room);
        return;
      }
    } catch (err) {
      // Server may have restarted or room expired; fall back to join form.
      if (err instanceof ApiClientError && err.status === 404) {
        appState.removeRecentRoom(code);
      }
    }
    appState.clearSession(code);
  }

  renderJoin(root, code);
}

function teardownRoom(): void {
  if (activeClient) {
    activeClient.close();
    activeClient = null;
  }
  if (activeTimer) {
    clearInterval(activeTimer);
    activeTimer = null;
  }
  playersRootRef = null;
}

function renderJoin(root: HTMLElement, code: string): void {
  clear(root);
  const container = el("div", { class: "join-hero" });
  container.append(
    el("h1", { text: "Join room" }),
    el("div", { class: "code", text: code }),
  );

  const form = el("form");

  const nameField = el("div", { class: "form-field" }, el("label", { text: "Your display name" }));
  const nameInput = el("input", {
    type: "text",
    placeholder: "e.g. Dave",
    maxLength: "30",
    autocomplete: "off",
  }) as HTMLInputElement;
  nameInput.value = appState.displayName;
  nameField.append(nameInput);
  form.append(nameField);

  const joinButton = el("button", { type: "submit", text: "Join Room" });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = inputValue(nameInput);
    if (!name) {
      showToast("Enter your name.", true);
      nameInput.focus();
      return;
    }
    joinButton.disabled = true;
    try {
      const result = await roomsApi.join(
        code,
        name,
        appState.getParticipantId(code) ?? undefined,
      );
      appState.setSession(result.roomCode, result.participantId, result.displayName);
      const room = await roomsApi.get(result.roomCode, result.participantId);
      await enterRoom(root, result.roomCode, { participantId: result.participantId, displayName: result.displayName }, room);
    } catch (err) {
      const isNotFound = err instanceof ApiClientError && err.status === 404;
      if (isNotFound) {
        appState.removeRecentRoom(code);
      }
      showToast(isNotFound ? "Room not found or expired." : format(err), true);
      joinButton.disabled = false;
    }
  });

  form.append(joinButton);
  container.append(form);
  root.append(container);
}

async function enterRoom(
  root: HTMLElement,
  code: string,
  session: SessionIdentity,
  initialRoom: PublicRoom,
): Promise<void> {
  const state = new RoomState(initialRoom, session);

  clear(root);
  const wrapper = el("div", { class: "room-page" });

  // Room header: "<scrum master> Estimation Room".
  const roomHeader = el("header", { class: "room-header" });
  const title = el("h1", {
    class: "room-title",
    text: roomTitle(state, code),
  });
  roomHeader.append(title);
  wrapper.append(roomHeader);

  // Two-column body.
  const content = el("div", { class: "room-content" });

  const left = el("div", { class: "room-left" });
  const deckRoot = el("section", { class: "deck-panel" });
  const storyRoot = el("section", { class: "story-wrap" });
  left.append(deckRoot, storyRoot);

  const right = el("aside", { class: "room-right" });
  const playersRoot = el("div");
  right.append(playersRoot);

  content.append(left, right);
  wrapper.append(content);
  root.append(wrapper);

  playersRootRef = playersRoot;

  // ---- Actions ----
  function leave(): void {
    // Keep the stored identity so "Rejoin" resumes this participant instead
    // of creating a duplicate; it is cleared only when the server says the
    // participant no longer exists.
    teardownRoom();
    navigate("/");
  }

  function refresh(): Promise<void> {
    return roomsApi
      .get(code, session.participantId)
      .then((room) => {
        state.room = room;
        state.myCard = room.self?.selectedCard ?? null;
        renderAll();
      })
      .catch(() => {
        // Keep current view; WebSocket events will still reconcile.
      });
  }

  function renderAll(): void {
    title.textContent = roomTitle(state, code);

    renderEstimationDeck(deckRoot, state, async (card) => {
      try {
        await roomsApi.vote(code, card);
        const me = state.room.participants.find((p) => p.id === session.participantId);
        if (me) me.hasSelected = true;
        state.setMyCard(card);
        renderAll();
      } catch (err) {
        showToast("Could not vote: " + format(err), true);
      }
    }, async (estimate) => {
      const story = state.room.story;
      if (!story || !story.key) {
        showToast("No story is active for this round.", true);
        return;
      }
      try {
        await roomsApi.recordAgreedEstimate(code, story.key, estimate);
        await refresh();
      } catch (err) {
        showToast("Could not record estimate: " + format(err), true);
      }
    });
    renderStoryPanel(storyRoot, state, refresh);
    renderPlayersPanel(playersRoot, state, {
      onReveal: async () => {
        try {
          await roomsApi.reveal(code);
          await refresh();
        } catch (err) {
          showToast("Could not reveal: " + format(err), true);
        }
      },
      onNewRound: async () => {
        try {
          await roomsApi.newRound(code);
          await refresh();
        } catch (err) {
          showToast("Could not start round: " + format(err), true);
        }
      },
      onRemove: async (targetParticipantId) => {
        try {
          await roomsApi.removeParticipant(code, targetParticipantId);
          await refresh();
        } catch (err) {
          showToast("Could not remove participant: " + format(err), true);
        }
      },
      onLeave: leave,
    });
  }

  renderAll();

  // Room running-time clock (also refreshes every player's elapsed time).
  activeTimer = setInterval(() => {
    if (playersRootRef) updateTimers(playersRootRef, state.room.createdAt);
  }, 1000);

  // Realtime
  async function connectWs(): Promise<void> {
    try {
      const { url, protocol, group } = await roomsApi.negotiate(
        code,
        session.participantId,
      );
      const client = new RealtimeClient({
        url,
        protocol,
        group,
        renegotiate: () =>
          roomsApi.negotiate(code, session.participantId).then((result) => result.url),
        onEvent(evt) {
          if (
            evt.type === "participant.left" &&
            evt.participant.id === session.participantId
          ) {
            handleRemoved("You were removed from the room.");
            return;
          }
          state.applyEvent(evt);
          renderAll();
        },
        onStatus() {
          // Presence is reflected through participant.updated events.
        },
        onUnauthorized() {
          handleRemoved("You are no longer in this room.");
        },
      });
      client.join(code, session.participantId);
      activeClient = client;
    } catch (err) {
      if (
        err instanceof ApiClientError &&
        (err.status === 403 || err.status === 404)
      ) {
        handleRemoved("You are no longer in this room.");
        return;
      }
      setTimeout(connectWs, 5_000);
    }
  }

  void connectWs();
}

function handleRemoved(message: string): void {
  showToast(message, true);
  teardownRoom();
  navigate("/");
}

function roomTitle(state: RoomState, code: string): string {
  const facilitator = state.facilitatorName();
  return facilitator
    ? `${firstName(facilitator)} Estimation Room`
    : `Room ${code} Estimation Room`;
}

function format(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "Unknown error.";
}