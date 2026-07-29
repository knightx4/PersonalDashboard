/**
 * Deterministic short titles for long merchant / SEO product names.
 * Prefer LLM shortName at ingest when present; this is the fallback.
 */

const TRAILING_STORE =
  /\s*[-–|]\s*(amazon\.com|amazon|target|walmart|ebay|etsy|best buy)\s*$/i;

/** Drop common Amazon-style filler phrases when they dominate the title. */
const FILLER_PHRASE =
  /\b(with|for|and|the|a|an|of|to|in|on|by|new|pack|set|kit|bundle|assorted|multi[- ]?pack)\b/gi;

export function shortNameFromTitle(name: string, maxWords = 6, maxChars = 48): string {
  let value = name.trim().replace(/\s+/g, ' ');
  if (!value) return name.trim();

  value = value.replace(TRAILING_STORE, '').trim();

  const comma = value.indexOf(',');
  if (comma >= 12 && comma < 80) {
    value = value.slice(0, comma).trim();
  }

  const paren = value.indexOf('(');
  if (paren >= 12) {
    value = value.slice(0, paren).trim();
  }

  let words = value.split(/\s+/).filter(Boolean);
  if (words.length > maxWords + 2) {
    // Prefer content words when the title is very long.
    const content = words.filter((word) => !FILLER_PHRASE.test(word));
    FILLER_PHRASE.lastIndex = 0;
    if (content.length >= 3) words = content;
  }

  if (words.length > maxWords) words = words.slice(0, maxWords);

  let result = words.join(' ');
  if (result.length > maxChars) {
    result = `${result.slice(0, maxChars - 1).trimEnd()}…`;
  }
  return result || name.trim().slice(0, maxChars);
}

/** Prefer a model-provided short name when it looks usable. */
export function coalesceShortName(
  rawName: string,
  candidate: string | null | undefined,
): string {
  const trimmed = candidate?.trim();
  if (!trimmed) return shortNameFromTitle(rawName);
  if (trimmed.length < 2) return shortNameFromTitle(rawName);
  if (trimmed.length > 80) return shortNameFromTitle(trimmed);
  // Reject near-copies of the full SEO blob.
  if (trimmed.length > 60 && trimmed.length > rawName.length * 0.7) {
    return shortNameFromTitle(rawName);
  }
  return trimmed.replace(/\s+/g, ' ');
}
