import type { ImportCandidate, ImportResult } from "./import-types.ts";

const ITEM_RE = /<item[^>]*>([\s\S]*?)<\/item>/gi;
const DESCRIPTION_MAX = 500;

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[/g, "")
    .replace(/\]\]>/g, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function childContent(xml: string, name: string): string {
  const match = xml.match(
    new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, "i"),
  );
  return match ? decodeXml(match[1] ?? "").trim() : "";
}

function keyFromUrl(value: string): string | undefined {
  const match = value.match(/\/browse\/([A-Za-z][A-Za-z0-9_]*-\d+)/i);
  return match ? match[1]!.toUpperCase() : undefined;
}

function keyFromTitle(title: string): string | undefined {
  const match = title.match(/^\s*[\[(]?\s*([A-Za-z][A-Za-z0-9_]*-\d+)/);
  return match ? match[1]!.toUpperCase() : undefined;
}

function browseUrl(value: string): string | undefined {
  const match = value.match(/https?:\/\/[^\s?#]+\/browse\/[A-Za-z0-9_]+-\d+/i);
  return match ? match[0].split(/[?#]/)[0] : undefined;
}

/**
 * Parses a Jira export XML / RSS. Handles both the per-issue XML view and the
 * filter activity feed; comment/activity items are skipped.
 */
export function parseJiraRss(xml: string): ImportResult {
  const items = [...xml.matchAll(ITEM_RE)].map((m) => m[1] ?? "");
  if (items.length === 0) {
    throw new Error("The XML has no <item> entries.");
  }

  const stories: ImportCandidate[] = [];
  let skipped = 0;
  for (const item of items) {
    const link = childContent(item, "link");
    const guid = childContent(item, "guid");
    const title = childContent(item, "title");
    const key = childContent(item, "key") ||
      keyFromUrl(`${link} ${guid}`) ||
      keyFromTitle(title);

    if (!key) {
      skipped += 1;
      continue;
    }

    const isComment =
      /focusedCommentId=|#comment-|comment-tabpanel|^RE:\s+/i.test(
        `${link} ${guid} ${title}`,
      );
    if (isComment) {
      skipped += 1;
      continue;
    }

    const summary = title
      .replace(/^\[[A-Za-z][A-Za-z0-9_]*-\d+\][\s:]*/i, "")
      .replace(/^[A-Za-z][A-Za-z0-9_]*-\d+\s*[-–:]\s*/i, "")
      .trim();
    const description = decodeXml(childContent(item, "description"))
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, DESCRIPTION_MAX - 1);

    stories.push({
      key,
      title: `${key} - ${summary || key}`,
      description,
      url: browseUrl(`${link} ${guid}`),
    });
  }
  return { source: "xml", stories, skipped };
}