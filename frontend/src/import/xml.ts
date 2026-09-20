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

/** Raw (still-encoded) content of a child element. */
function rawChildContent(xml: string, name: string): string {
  const match = xml.match(
    new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, "i"),
  );
  return match ? match[1] ?? "" : "";
}

/**
 * Extracts the inner HTML of the element with id="descriptionArea" (a table
 * cell in Jira's RSS export) using balanced tag-nesting until its closing tag.
 */
function extractDescriptionArea(html: string): string | undefined {
  const open = html.match(
    /<(td|div)[^>]*id=["']descriptionArea["'][^>]*>/i,
  );
  if (!open) return undefined;
  const tag = open[1]!;
  const rest = html.slice((open.index ?? 0) + open[0].length);
  const re = new RegExp(`<${tag}\\b[^>]*>|<\\/${tag}>`, "gi");
  let depth = 1;
  let m: RegExpExecArray | null;
  let end = rest.length;
  while ((m = re.exec(rest)) !== null) {
    if (m[0].startsWith("</")) {
      depth -= 1;
      if (depth === 0) {
        end = m.index;
        break;
      }
    } else {
      depth += 1;
    }
  }
  return rest.slice(0, end);
}

/**
 * Converts Jira export HTML descriptions to plain text. The RSS feed
 * entity-encodes the whole issue page (CSS style block, header tables), so the
 * style/script blocks are dropped and the `#descriptionArea` cell is preferred
 * before tags are flattened.
 */
function descriptionToText(raw: string): string {
  const decodeTags = (value: string): string =>
    value
      .replace(/<!\[CDATA\[/g, "")
      .replace(/\]\]>/g, "")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;|&#39;/g, "'");

  let s = decodeTags(raw);
  s = s
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ");
  const area = extractDescriptionArea(s);
  if (area !== undefined) s = area;
  s = s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li|tr|ol|ul|h[1-6]|table|blockquote)>\s*/gi, "\n")
    .replace(/<\/t[dh]>\s*/gi, " | ")
    .replace(/<[^>]+>/g, "");
  return s
    .replace(/&nbsp;|&#160;/g, " ")
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
    const description = descriptionToText(rawChildContent(item, "description"))
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