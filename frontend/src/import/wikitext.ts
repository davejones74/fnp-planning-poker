const FENCE_RE = /\{(?:code|quote|noformat)(?::[^}]*)?\}([\s\S]*?)\{(?:code|quote|noformat)\}/g;

function isUrlLike(label: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(label);
}

/** Collapses the atom of markup and truncates to a safe length for a story. */
export function wikitextToPlain(text: string, maxLength = 500): string {
  let out = text
    .replace(FENCE_RE, (_m, inner: string) => inner ?? "")
    .replace(/^\s*h\d+(\.|#)?\s*/gm, "")
    .replace(/\{\*|\*\}/g, "")
    .replace(/\*+/g, "")
    .replace(/_{2,}/g, "")
    .replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,;:!?]|$)/gm, "$1$2")
    .replace(/\{\{(.+?)\}\}/g, "$1")
    .replace(/\[([^\[\]|]*)\|([^\[\]]*)\]/g, (m, label: string, target: string) => {
      void m;
      void target;
      return isUrlLike(label) ? "" : label.trim();
    })
    .replace(/\[~accountid:[^\]]*\]/g, "")
    .replace(/^\s*[#*+\-]\s+/gm, "")
    .replace(/^\s*\|+/gm, "")
    .replace(/\|\s*$/gm, "")
    .replace(/\|/g, " | ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (out.length > maxLength) {
    out = `${out.slice(0, maxLength - 1)}…`;
  }
  return out;
}