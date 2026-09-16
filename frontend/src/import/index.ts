import { parseJiraCsv } from "./csv.ts";
import { parseJiraRss } from "./xml.ts";
import type { ImportCandidate, ImportResult } from "./import-types.ts";

/** Detects a Jira CSV or RSS/XML export from its raw text. */
export function sniffImport(text: string): "csv" | "xml" | null {
  let t = text.replace(/^\uFEFF/, "").trimStart();
  for (let pass = 0; pass < 4; pass++) {
    const next = t.replace(/^<\?[\s\S]*?\?>/, "").replace(/^<!--[\s\S]*?-->/, "").trimStart();
    if (next === t) break;
    t = next;
  }
  if (/^<(?:rss|feed|xml|channel)\b/i.test(t)) return "xml";
  const head = t.slice(0, 4000);
  if (/,/.test(head) && /\b(?:key|summary)\b/i.test(head)) return "csv";
  return null;
}

/** Parses a Jira CSV or RSS/XML export into import candidates. */
export function parseFileImport(text: string): ImportResult {
  const kind = sniffImport(text);
  if (kind === "csv") return parseJiraCsv(text);
  if (kind === "xml") return parseJiraRss(text);
  throw new Error("Unrecognised file — expected a Jira CSV or RSS/XML export.");
}

/** Builds https://<host>/browse/<KEY> from the configured Jira site. */
export function buildStoryUrl(key: string, jiraHost?: string | null): string | undefined {
  const host = jiraHost?.trim().replace(/\/+$/, "");
  if (!host) return undefined;
  const base = /^https?:\/\//i.test(host) ? host : `https://${host}`;
  return `${base}/browse/${key}`;
}

/** Keeps only issues from the configured project prefix (e.g. "PAY"). */
export function filterByProject(
  stories: ImportCandidate[],
  projectKey?: string | null,
): ImportCandidate[] {
  const prefix = projectKey?.trim().toUpperCase();
  if (!prefix) return stories;
  return stories.filter((story) =>
    story.key.toUpperCase().startsWith(`${prefix}-`),
  );
}

/** Sniffs, parses, links ticket urls and applies the KEY project filter. */
export function prepareImport(
  text: string,
  options: { jiraHost?: string | null; jiraProjectKey?: string | null },
): ImportResult {
  const result = parseFileImport(text);
  result.stories = filterByProject(result.stories, options.jiraProjectKey);
  for (const story of result.stories) {
    story.url = story.url ?? buildStoryUrl(story.key, options.jiraHost);
  }
  return result;
}