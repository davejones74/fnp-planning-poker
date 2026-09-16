export interface ImportCandidate {
  key: string;
  title: string;
  description: string;
  url?: string;
}

export interface ImportResult {
  source: "csv" | "xml";
  stories: ImportCandidate[];
  /** Rows/items that had no usable issue key or were comment-only. */
  skipped: number;
}