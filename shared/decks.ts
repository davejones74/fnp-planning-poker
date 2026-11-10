import type { CardValue, DeckId } from "./types.ts";

export interface DeckDefinition {
  id: DeckId;
  label: string;
  cards: CardValue[];
}

export interface DeckGuideRow {
  value: CardValue;
  label: string;
  guidance: string;
}

export interface DeckGuide {
  title: string;
  subtitle: string;
  valueHeader: string;
  guidanceHeader: string;
  rows: DeckGuideRow[];
}

export interface DeckCatalog {
  /** Known decks; add more named properties to make them selectable. */
  [key: string]: DeckDefinition | undefined;
  fandp: DeckDefinition;
  fibonacci: DeckDefinition;
}

/**
 * Configurable estimation decks. `fandp` is the historical id for the
 * T-Shirt Sizes deck; `fibonacci` is the default.
 */
export const DECKS: DeckCatalog = {
  fibonacci: {
    id: "fibonacci",
    label: "Fibonacci",
    cards: ["1", "2", "3", "5", "8", "13", "21", "40", "?", "coffee"],
  },
  fandp: {
    id: "fandp",
    label: "T-Shirt Sizes",
    cards: ["XS", "S", "M", "L", "XL", "XXL", "?", "coffee"],
  },
};

export const DEFAULT_DECK_ID: DeckId = "fibonacci";

const SHIRT_VALUES = new Set<string>(["XS", "S", "M", "L", "XL", "XXL"]);

/** Resolves a deck id from configuration (case-insensitive). */
export function deckById(value: unknown): DeckDefinition | undefined {
  if (typeof value !== "string") return undefined;
  return DECKS[value.trim().toLocaleLowerCase()];
}

/** Works out which deck an existing card array belongs to (legacy rows). */
export function inferDeckId(cards: readonly CardValue[]): DeckId {
  return cards.some((card) => SHIRT_VALUES.has(card)) ? "fandp" : "fibonacci";
}

export const DECK_GUIDES: Record<DeckId, DeckGuide> = {
  fibonacci: {
    title: "Fibonacci story points",
    subtitle:
      "Story points are relative. The durations below are indicative, not commitments.",
    valueHeader: "Points",
    guidanceHeader: "Guidance",
    rows: [
      {
        value: "1",
        label: "1",
        guidance:
          "Very small, well-understood change such as a cosmetic UI tweak or trivial fix. One person can complete and verify it in a few hours.",
      },
      {
        value: "2",
        label: "2",
        guidance:
          "Small, low-risk task such as a straightforward bug fix or minor enhancement. About one day for one person.",
      },
      {
        value: "3",
        label: "3",
        guidance:
          "Contained change such as a small performance improvement or refactor. Typically one to two days including testing.",
      },
      {
        value: "5",
        label: "5",
        guidance:
          "Roughly a week of effort for one developer. Example: add a database table and wire the application code to read and write it.",
      },
      {
        value: "8",
        label: "8",
        guidance:
          "Typical sprint story for one developer/QA pair. Example: connect frontend API calls to a new backend service. Near the upper limit for a comfortable single-sprint item.",
      },
      {
        value: "13",
        label: "13",
        guidance:
          "Largest item one developer should carry in a sprint. A largely isolated implementation that may need support from others, or carries notable complexity, dependencies or risk.",
      },
      {
        value: "21",
        label: "21",
        guidance:
          "Too large for one developer in a sprint. Requires multiple developers and QA working together; split it before committing.",
      },
      {
        value: "40",
        label: "40",
        guidance:
          "Epic that has not yet been broken down. Scope and approach are unclear; decompose it before estimating reliably.",
      },
      {
        value: "?",
        label: "?",
        guidance:
          "Unknown — needs investigation or discussion in the room before estimating.",
      },
    ],
  },
  fandp: {
    title: "T-Shirt sizing",
    subtitle: "Relative sizing with an indicative duration.",
    valueHeader: "Size",
    guidanceHeader: "Approx. duration",
    rows: [
      { value: "XS", label: "XS", guidance: "0.5–1 day" },
      { value: "S", label: "S", guidance: "2–4 days" },
      { value: "M", label: "M", guidance: "5–10 days" },
      { value: "L", label: "L", guidance: "11–21 days" },
      { value: "XL", label: "XL", guidance: "22–28 days" },
      { value: "XXL", label: "XXL", guidance: "No day range defined" },
      { value: "?", label: "?", guidance: "Unknown — discuss in the room" },
    ],
  },
};
