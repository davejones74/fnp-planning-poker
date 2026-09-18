import { el, clear } from "./dom.ts";
import type { RoomState } from "../state/room-state.ts";
import type { CardValue } from "../../../shared/types.ts";
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
): void {
  clear(root);

  const room = state.room;
  const voting = room.roundStatus === "voting";
  const container = el("div", { class: "estimation-deck" });

  if (room.roundStatus === "revealed") {
    container.append(renderVoteChart(room.participants, room.deck));
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