/** First whitespace-delimited word of a display name (e.g. "Dave Smith" -> "Dave"). */
export function firstName(displayName: string): string {
  const trimmed = displayName.trim();
  if (!trimmed) return "";
  return trimmed.split(/\s+/)[0] ?? trimmed;
}
