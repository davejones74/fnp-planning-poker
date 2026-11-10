import { el } from "./dom.ts";
import { DECK_GUIDES, deckById } from "../../../shared/decks.ts";
import type { DeckId } from "../../../shared/types.ts";

/** The deck's sizing table, shared by HOW IT WORKS and the quick guide dialog. */
export function renderDeckGuide(deckId: DeckId): HTMLElement {
  const guide = DECK_GUIDES[deckId] ?? DECK_GUIDES.fibonacci;
  const wrap = el("div", { class: "deck-guide" });
  wrap.append(
    el("h4", { class: "story-intro-sub", text: guide.title }),
    el("p", { class: "deck-guide-sub", text: guide.subtitle }),
  );

  const table = el("table", { class: "sizing-table" });
  const head = el("thead");
  const headRow = el("tr");
  headRow.append(
    el("th", { text: guide.valueHeader }),
    el("th", { text: guide.guidanceHeader }),
  );
  head.append(headRow);
  table.append(head);

  const body = el("tbody");
  for (const row of guide.rows) {
    const tr = el("tr");
    tr.append(
      el("td", { class: "sizing-size", text: row.label }),
      el("td", { text: row.guidance }),
    );
    body.append(tr);
  }
  table.append(body);
  wrap.append(table);
  return wrap;
}

/** Opens (or toggles closed) a modal with the active deck's sizing guide. */
export function openSizingGuide(deckId: DeckId): void {
  const existing = document.querySelector(".sizing-overlay");
  if (existing) {
    existing.remove();
    return;
  }

  const deck = deckById(deckId);
  const overlay = el("div", { class: "sizing-overlay" });
  const dialog = el("section", {
    class: "sizing-dialog",
    role: "dialog",
    "aria-modal": "true",
    "aria-label": `${deck?.label ?? "Deck"} sizing guide`,
  });

  const header = el("div", { class: "sizing-dialog-head" });
  const closeButton = el("button", {
    type: "button",
    class: "sizing-dialog-close",
    text: "Close",
    "aria-label": "Close sizing guide",
  });
  header.append(
    el("h3", {
      class: "sizing-dialog-title",
      text: "Sizing guide",
    }),
    closeButton,
  );

  dialog.append(header, renderDeckGuide(deckId));
  overlay.append(dialog);
  document.body.append(overlay);

  const close = (): void => {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape") close();
  };
  closeButton.addEventListener("click", close);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });
  document.addEventListener("keydown", onKey);
}
