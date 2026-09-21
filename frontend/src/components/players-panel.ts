import { el, clear, showToast } from "./dom.ts";
import type { RoomState } from "../state/room-state.ts";
import { formatElapsed } from "../util/time.ts";
import { MAX_ROOM_PARTICIPANTS } from "../../../shared/validation.ts";
import { outliersForRound } from "../util/estimates.ts";
import { checkIcon, clockIcon, coffeeIcon, personIcon, chevronIcon, copyIcon } from "./icons.ts";
import type { PublicParticipant } from "../../../shared/types.ts";

export interface PlayerPanelActions {
  onReveal: () => Promise<void> | void;
  onNewRound: () => Promise<void> | void;
  onRemove: (participantId: string) => Promise<void> | void;
  onLeave: () => void;
}

/**
 * Participants whose drop happened before the server began stamping offlineAt
 * have no anchor, so their clock is frozen at the first moment this browser saw
 * them offline. The cache keeps that anchor stable across panel re-renders.
 */
const offlineAnchorCache = new Map<string, string>();

function offlineAnchor(p: PublicParticipant, nowIso: string): string | undefined {
  if (p.offlineAt) {
    offlineAnchorCache.set(p.id, p.offlineAt);
    return p.offlineAt;
  }
  if (!p.connected) {
    const cached = offlineAnchorCache.get(p.id);
    if (cached) return cached;
    offlineAnchorCache.set(p.id, nowIso);
    return nowIso;
  }
  offlineAnchorCache.delete(p.id);
  return undefined;
}

/** Refresh every elapsed-time label in an already-rendered panel. */
export function updateTimers(panelRoot: HTMLElement, roomCreatedAt: string): void {
  panelRoot.querySelectorAll<HTMLElement>("[data-room-since]").forEach((node) => {
    node.textContent = formatElapsed(roomCreatedAt);
  });
  panelRoot.querySelectorAll<HTMLElement>("[data-player-since]").forEach((node) => {
    const end = node.dataset.playerOfflineAt
      ? new Date(node.dataset.playerOfflineAt).getTime()
      : undefined;
    node.textContent = formatElapsed(node.dataset.playerSince ?? roomCreatedAt, end);
  });
}

export function renderPlayersPanel(
  root: HTMLElement,
  state: RoomState,
  actions: PlayerPanelActions,
): void {
  clear(root);

  const room = state.room;
  const isFacilitator = state.isFacilitator();
  const voting = room.roundStatus === "voting";
  const revealed = room.roundStatus === "revealed";

  const panel = el("section", { class: "players-panel" });
  panel.append(renderStatusHeader(state, isFacilitator, voting, revealed, actions));

  const outliers = revealed
    ? outliersForRound(room.participants, room.roundId)
    : null;

  // Summary row: player count + room running time.
  const summary = el("div", { class: "player-summary" });
  summary.append(
    el(
      "span",
      { class: "summary-players" },
      "Players: ",
      el("b", { text: String(room.participants.length) }),
      el("span", {
        class: "summary-players-cap",
        text: ` / ${MAX_ROOM_PARTICIPANTS}`,
        title: `${MAX_ROOM_PARTICIPANTS - room.participants.length} connection(s) left`,
      }),
    ),
  );
  const timer = el("span", { class: "summary-timer" });
  timer.append(clockIcon(15), el("span", { "data-room-since": "", text: formatElapsed(room.createdAt) }));
  summary.append(timer);
  panel.append(summary);

  // Player rows.
  const list = el("ul", { class: "player-list" });
  for (const p of room.participants) {
    let rowClass = "player-row" + (p.id === state.myParticipantId ? " me" : "");
    if (outliers) {
      if (p.id === outliers.lowestId) rowClass += " highlight-lowest";
      else if (p.id === outliers.highestId) rowClass += " highlight-highest";
    }
    const row = el("li", { class: rowClass });

    const avatar = el("span", { class: "avatar", "aria-hidden": "true" });
    avatar.append(personIcon(24));
    avatar.append(el("span", { class: "presence-dot" + (p.connected ? " online" : " offline") }));
    row.append(avatar);

    const main = el("span", { class: "player-main" });
    const name = el("span", { class: "player-name", text: p.displayName });
    if (p.isFacilitator) name.append(moderatorLabel());
    if (outliers) {
      if (p.id === outliers.lowestId) name.append(outlierBadge("optimistic"));
      else if (p.id === outliers.highestId) name.append(outlierBadge("pessimistic"));
    }
    main.append(name);
    const playerSince = el("span", {
      class: "player-since",
      "data-player-since": p.joinedAt,
    });
    const anchor = offlineAnchor(p, new Date().toISOString());
    if (anchor) playerSince.setAttribute("data-player-offline-at", anchor);
    playerSince.textContent = formatElapsed(
      p.joinedAt,
      anchor ? new Date(anchor).getTime() : undefined,
    );
    main.append(playerSince);
    row.append(main);

    if (isFacilitator && p.id !== state.myParticipantId) {
      const remove = el("button", {
        class: "player-remove",
        type: "button",
        text: "Remove",
        title: `Remove ${p.displayName} from the room`,
        "aria-label": `Remove ${p.displayName} from the room`,
      });
      remove.addEventListener("click", () => {
        remove.disabled = true;
        void actions.onRemove(p.id);
      });
      row.append(remove);
    }

    const vote = el("span", { class: "player-vote" });
    if (revealed) {
      vote.className = "player-vote revealed";
      if (p.selectedCard === "coffee") vote.append(coffeeIcon(22));
      else vote.textContent = p.selectedCard ?? "–";
    } else if (p.hasSelected) {
      const check = checkIcon(18);
      check.classList.add("vote-check");
      vote.append(check);
    }
    row.append(vote);

    list.append(row);
  }
  panel.append(list);

  panel.append(renderInvitePanel(state, actions));

  root.append(panel);
}

function renderStatusHeader(
  state: RoomState,
  isFacilitator: boolean,
  voting: boolean,
  revealed: boolean,
  actions: PlayerPanelActions,
): HTMLElement {
  const header = el("header", { class: "voting-status" + (isFacilitator ? " is-facilitator" : "") });

  if (!isFacilitator) {
    header.append(
      el("p", {
        class: "voting-status-text",
        text: voting
          ? "Waiting for moderator to finalise vote"
          : revealed
            ? "Votes revealed — waiting for a new round"
            : "Waiting for the round to start",
      }),
    );
    return header;
  }

  const statusText = el("p", {
    class: "voting-status-text",
    text: revealed ? "Votes are revealed" : "Waiting for everyone to vote",
  });
  const action = el("button", {
    class: "voting-action",
    type: "button",
    text: voting ? "Reveal Cards" : "Start New Round",
    disabled: voting ? false : !revealed,
  });
  header.append(statusText, action);

  action.addEventListener("click", () => {
    action.disabled = true;
    void (voting ? actions.onReveal() : actions.onNewRound());
  });

  return header;
}

function moderatorLabel(): HTMLElement {
  return el("span", {
    class: "moderator-label",
    title: "Facilitator",
    "aria-label": "Facilitator",
    text: "[facilitator]",
  });
}

function outlierBadge(kind: "optimistic" | "pessimistic"): HTMLElement {
  const optimistic = kind === "optimistic";
  const node = el("span", {
    class: "outlier-badge " + kind,
    title: optimistic
      ? "Optimistic — lowest estimate"
      : "Pessimistic — highest estimate",
    "aria-label": optimistic
      ? "Optimistic — lowest estimate"
      : "Pessimistic — highest estimate",
  });
  node.textContent = optimistic ? "▼" : "▲";
  return node;
}

function renderInvitePanel(
  state: RoomState,
  actions: PlayerPanelActions,
): HTMLElement {
  const container = el("div", { class: "invite-panel" });

  const toggle = el("button", { class: "invite-toggle", type: "button" });
  toggle.append(
    el("span", { text: "Invite a teammate" }),
    el("span", { class: "invite-chevron" }, chevronIcon(16)),
  );
  container.append(toggle);

  const body = el("div", { class: "invite-body" });

  const roomUrl: string = location.href.split("?")[0] ?? location.href;
  const code = state.room.code;

  const codeRow = el("div", { class: "invite-row" });
  codeRow.append(
    el("span", { class: "invite-code-label", text: "Room code" }),
    el("code", { class: "invite-code", text: code }),
  );
  body.append(codeRow);

  const linkRow = el("div", { class: "invite-row invite-link-row" });
  linkRow.append(el("span", {
    class: "invite-link",
    text: roomUrl,
    title: roomUrl,
  }));
  body.append(linkRow);

  const copyButton = el(
    "button",
    { class: "invite-copy", type: "button" },
    copyIcon(15),
    " Copy join link",
  );
  copyButton.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(roomUrl);
      showToast("Join link copied!", false);
    } catch {
      showToast("Could not copy link.", true);
    }
  });
  body.append(copyButton);

  const leaveButton = el("button", { class: "invite-leave", type: "button", text: "Leave room" });
  leaveButton.addEventListener("click", () => actions.onLeave());
  body.append(leaveButton);

  container.append(body);

  toggle.addEventListener("click", () => {
    const open = body.classList.toggle("open");
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    container.classList.toggle("open", open);
  });

  return container;
}