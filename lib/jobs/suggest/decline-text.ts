/**
 * What the person typed when turning a recommended role down (plan #2504.3),
 * as job_search.suggestions.dismiss_text stores it (0068): trimmed, cut at
 * DECLINE_TEXT_MAX characters, and nothing at all when the box was left
 * empty, since a decline with no words is still a decline.
 */

export const DECLINE_TEXT_MAX = 500;

export function declineText(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const text = raw.trim().slice(0, DECLINE_TEXT_MAX).trim();
  return text || null;
}
