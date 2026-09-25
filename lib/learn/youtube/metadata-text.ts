/**
 * What a video's title and description are embedded as (learn migration 0059).
 *
 * Pure, so it is tested without a network. A channel's descriptions are mostly
 * the same boilerplate on every upload: links, sponsor reads, "subscribe",
 * social handles. Left in, that text pulls every video from one channel
 * toward the others and away from its subject, so links and lines that are
 * only hashtags or handles are dropped, and the description is cut short
 * where the subject is usually stated.
 */

/** Characters of description kept after cleaning. */
export const METADATA_DESCRIPTION_CHARS = 800;

const URL = /https?:\/\/\S+|www\.\S+/gi;

/** A line with nothing left but hashtags, handles and punctuation. */
const NOISE_LINE = /^[\s#@\p{P}\p{S}\w]*$/u;

function isNoise(line: string): boolean {
  const words = line.split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  // Only tags and handles: "#science #physics", "@veritasium".
  if (words.every((word) => /^[#@]/.test(word))) return true;
  // A label with nothing after it once its link is gone: "Patreon:", "Twitter -".
  return words.length <= 3 && /[:\-–|]\s*$/.test(line) && NOISE_LINE.test(line);
}

export function metadataText(title: string, description: string | null): string {
  const cleanTitle = title.trim();
  const lines = (description ?? '')
    .replace(URL, '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => !isNoise(line));

  let body = '';
  for (const line of lines) {
    if (body.length + line.length + 1 > METADATA_DESCRIPTION_CHARS) break;
    body += (body ? '\n' : '') + line;
  }
  if (!body && lines[0]) body = lines[0].slice(0, METADATA_DESCRIPTION_CHARS);

  // The title alone is never empty in the catalogue, but a title of spaces
  // would be refused by the embedding call, so fall back to the body.
  return [cleanTitle, body].filter(Boolean).join('\n\n') || 'Untitled video';
}
