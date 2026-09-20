import { el, clear, showToast } from "./dom.ts";
import type { RoomState } from "../state/room-state.ts";
import type { CardValue, Story } from "../../../shared/types.ts";
import { coffeeIcon } from "./icons.ts";
import { renderVoteChart } from "./vote-chart.ts";

const COFFEE = "coffee";

function ariaLabel(value: CardValue): string {
  if (value === COFFEE) return "Select coffee / break";
  if (value === "?") return "Select unknown estimation";
  return `Select ${value} estimation`;
}

function cornerNode(value: CardValue, kind: "tl" | "br"): HTMLElement {
  const node = el("span", { class: `card-corner ${kind}` });
  if (value === COFFEE) {
    const icon = coffeeIcon(13);
    node.append(icon);
  } else {
    node.textContent = value;
  }
  return node;
}

function valueNode(value: CardValue): HTMLElement {
  const node = el("span", { class: "card-value" });
  if (value === COFFEE) {
    const icon = coffeeIcon(40);
    icon.setAttribute("class", "card-coffee-icon");
    node.append(icon);
  } else {
    node.textContent = value;
  }
  return node;
}

export function renderEstimationDeck(
  root: HTMLElement,
  state: RoomState,
  onVote: (card: string) => Promise<void> | void,
  onRecordEstimate: (estimate: string) => Promise<void> | void,
): void {
  clear(root);

  const room = state.room;
  const voting = room.roundStatus === "voting";
  const container = el("div", { class: "estimation-deck" });

  if (room.story) container.append(storyBanner(room.story));

  if (room.roundStatus === "revealed") {
    container.append(renderVoteChart(room.participants, room.deck));
    const footer = renderRevealFooter(state, onRecordEstimate);
    if (footer.firstChild) container.append(footer);
    root.append(container);
    return;
  }

  const grid = el("div", { class: "deck-grid" });

  room.deck.forEach((card, index) => {
    const isSelected = state.myCard === card;
    const button = el("button", {
      type: "button",
      class: "estimation-card" + (isSelected ? " selected" : ""),
      disabled: !voting,
      "aria-label": ariaLabel(card),
      "aria-pressed": isSelected ? "true" : "false",
    });
    button.append(
      cornerNode(card, "tl"),
      el("span", { class: "card-inner" }, valueNode(card)),
      cornerNode(card, "br"),
    );

    if (voting) {
      button.addEventListener("click", () => {
        void onVote(card);
      });
    }
    // 5 cards per row; row 2 (XXL, ?, coffee) aligns beneath card 2.
    const col = index < 5 ? index + 1 : index - 3;
    const row = index < 5 ? 1 : 2;
    button.style.gridRow = String(row);
    button.style.gridColumn = String(col);
    grid.append(button);
  });

  container.append(grid);
  root.append(container);
}

function storyBanner(story: Story): HTMLElement {
  const banner = el("div", { class: "story-banner" });
  const header = el("div", { class: "story-banner-header" });
  header.append(el("span", { class: "story-banner-key", text: story.key }));
  if (story.url) {
    header.append(
      el("a", {
        class: "story-banner-link",
        href: story.url,
        target: "_blank",
        rel: "noopener noreferrer",
        text: "Open in Jira ↗",
      }),
    );
  }
  banner.append(header);
  banner.append(el("p", { class: "story-banner-title", text: story.title }));
  if (story.description) {
    banner.append(el("p", { class: "story-banner-desc", text: story.description }));
  }
  return banner;
}

/**
 * Reveal footer: a discussion prompt when estimates differ, plus the
 * facilitator's "record agreed estimate" control for story rounds.
 */
function renderRevealFooter(
  state: RoomState,
  onRecordEstimate: (estimate: string) => Promise<void> | void,
): HTMLElement {
  const box = el("div", { class: "reveal-agreement" });
  const room = state.room;

  const estimates = room.participants
    .filter((p) => p.selectedCard && p.selectedCard !== "coffee")
    .map((p) => p.selectedCard as CardValue);
  const differ = new Set(estimates).size > 1;

  if (differ) {
    box.append(
      el("p", {
        class: "reveal-discuss",
        text:
          "Cards differ — discuss the spread (outliers are highlighted) and agree on an estimate as a team.",
      }),
    );
  }

  const story = room.story;
  if (!story || !state.isFacilitator()) return box;

  const row = el("div", { class: "agreement-row" });
  row.append(el("label", { class: "agreement-label", text: "Agreed estimate" }));

  const select = el("select", { class: "agreement-select", "aria-label": "Agreed estimate" }) as HTMLSelectElement;
  const placeholder = el("option", { value: "", text: "Select estimate…" });
  select.append(placeholder);
  for (const card of room.deck) {
    if (card === "coffee") continue;
    select.append(el("option", { value: card, text: card }));
  }

  const record = el("button", {
    type: "button",
    class: "agreement-record",
    text: "Record Estimate & Continue",
    disabled: true,
  });

  select.addEventListener("change", () => {
    record.disabled = select.value === "";
  });

  record.addEventListener("click", () => {
    const estimate = select.value;
    if (!estimate) {
      showToast("Choose an agreed estimate first.", true);
      return;
    }
    record.disabled = true;
    void onRecordEstimate(estimate);
  });

  row.append(select, record);
  box.append(row);
  return box;
}