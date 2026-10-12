/**
 * A capture token's name (plan #1705), apart from lib/capture/tokens.ts so the
 * account page's client code can read the limit without pulling node:crypto
 * into the browser bundle.
 */

/** The longest label core.capture_tokens accepts. */
export const CAPTURE_TOKEN_LABEL_MAX = 60;

/** A label as stored: trimmed, inner whitespace collapsed, and cut to the limit. */
export function captureTokenLabel(raw: string): string | null {
  const label = raw.replace(/\s+/g, ' ').trim().slice(0, CAPTURE_TOKEN_LABEL_MAX).trim();
  return label === '' ? null : label;
}
