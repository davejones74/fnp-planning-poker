import { el } from "./dom.ts";
import type { CardValue, PublicParticipant } from "../../../shared/types.ts";

export interface VoteSlice {
  value: CardValue;
  count: number;
}

const PALETTE = [
  "#4895e5",
  "#22c55e",
  "#ef6c57",
  "#a855f7",
  "#eab308",
  "#14b8a6",
  "#f97316",
  "#ec4899",
  "#6366f1",
  "#84cc16",
  "#06b6d4",
  "#f43f5e",
];

/** Tally revealed votes, ordered by the room's deck order (stable slice order). */
export function voteCounts(
  participants: PublicParticipant[],
  deck: CardValue[],
): VoteSlice[] {
  const counts = new Map<CardValue, number>();
  for (const p of participants) {
    if (!p.hasSelected || !p.selectedCard) continue;
    counts.set(p.selectedCard, (counts.get(p.selectedCard) ?? 0) + 1);
  }
  return deck
    .filter((value) => counts.has(value))
    .map((value) => ({ value, count: counts.get(value) as number }));
}

function colorFor(index: number): string {
  return PALETTE[index % PALETTE.length] as string;
}

function donutStyle(slices: VoteSlice[], total: number): string {
  let angle = 0;
  const stops: string[] = [];
  slices.forEach((slice, index) => {
    const start = angle;
    angle += (slice.count / total) * 360;
    stops.push(`${colorFor(index)} ${start}deg ${angle}deg`);
  });
  return `conic-gradient(${stops.join(", ")})`;
}

/** Donut chart of the revealed vote distribution plus a coloured legend. */
export function renderVoteChart(
  participants: PublicParticipant[],
  deck: CardValue[],
): HTMLElement {
  const slices = voteCounts(participants, deck);
  const total = slices.reduce((sum, slice) => sum + slice.count, 0);

  const container = el("div", { class: "vote-chart" });
  if (total === 0) {
    container.append(el("p", { class: "vote-chart-empty", text: "No votes to display yet." }));
    return container;
  }

  const donut = el("div", { class: "vote-donut" });
  donut.style.background = donutStyle(slices, total);
  donut.append(el("span", { class: "vote-donut-center", text: String(total) }));
  container.append(donut);

  const legend = el("ul", { class: "vote-legend" });
  slices.forEach((slice, index) => {
    const row = el("li", { class: "vote-legend-row" });
    row.append(
      el("span", {
        class: "vote-legend-swatch",
        style: `background: ${colorFor(index)}`,
        "aria-hidden": "true",
      }),
      el("span", { class: "vote-legend-value", text: slice.value }),
      el("span", { class: "vote-legend-count", text: String(slice.count) }),
    );
    legend.append(row);
  });
  container.append(legend);

  return container;
}