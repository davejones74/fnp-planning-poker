import { wikitextToPlain } from "./wikitext.ts";
import type { ImportCandidate, ImportResult } from "./import-types.ts";

const JIRA_KEY_RE = /^[A-Za-z][A-Za-z0-9_]*-\d+$/;

/** RFC 4180-ish tokenizer: quotes, "" escapes, embedded newlines, CRLF. */
export function parseCsv(text: string): string[][] {
  const s = text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  while (i < s.length) {
    const c = s[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i += 1;
        }
      } else {
        field += c;
        i += 1;
      }
    } else if (c === '"' && field.length === 0) {
      inQuotes = true;
      i += 1;
    } else if (c === ",") {
      row.push(field);
      field = "";
      i += 1;
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += 1;
    } else {
      field += c;
      i += 1;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Parses a Jira CSV export (columns Summary / Issue key / Description …). */
export function parseJiraCsv(text: string): ImportResult {
  const rows = parseCsv(text);
  if (rows.length === 0) {
    throw new Error("The file is empty.");
  }
  const header = rows[0]!;

  const indexOf = (...names: string[]): number =>
    header.findIndex((cell) => {
      const name = cell.trim().toLowerCase();
      return names.some((n) => name === n || name.startsWith(n));
    });

  const iSummary = indexOf("summary");
  const iKey = indexOf("issue key", "key");
  const iDesc = indexOf("description");
  if (iSummary < 0 || iKey < 0) {
    throw new Error(
      "Unrecognised CSV — expected a Jira export with 'Issue key' and 'Summary' columns.",
    );
  }

  const stories: ImportCandidate[] = [];
  let skipped = 0;
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]!;
    const key = (row[iKey] ?? "").trim().toUpperCase();
    if (!key || !JIRA_KEY_RE.test(key)) {
      skipped += 1;
      continue;
    }
    const summary = (iSummary >= 0 ? row[iSummary] : "")?.trim() ?? "";
    const description = wikitextToPlain(iDesc >= 0 ? (row[iDesc] ?? "") : "");
    stories.push({ key, title: `${key} - ${summary || key}`, description });
  }
  return { source: "csv", stories, skipped };
}