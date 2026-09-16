import type { CardValue } from "./types.ts";

export interface DeckCatalog {
  /** Known decks; add more named properties to make them configurable. */
  [key: string]: CardValue[] | undefined;
  fandp: CardValue[];
  fibonacci: CardValue[];
}

/**
 * Configurable estimation decks. Add more entries here to make them
 * selectable via the DEFAULT_DECK environment variable.
 */
export const DECKS: DeckCatalog = {
  fandp: ["XS", "S", "M", "L", "XL", "XXL", "?", "coffee"],
  fibonacci: ["0", "1", "2", "3", "5", "8", "13", "21", "34", "55", "?"],
};

export const DEFAULT_DECK_NAME = "fandp";