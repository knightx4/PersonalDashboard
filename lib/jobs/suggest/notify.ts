import type { PushPayload } from '@/lib/push/send';

/** The page the suggestions are on. */
export const SUGGESTIONS_URL = '/jobs/today';

/**
 * The phone notification for a run that wrote something, or null when it
 * wrote nothing. Names the first person by their headline, since "Ask Priya
 * for a referral at Acme" is worth reading on a lock screen and a count is
 * not, and counts the rest.
 */
export function suggestionsPayload(
  written: { people: readonly string[]; roles: readonly string[] },
  day: string,
): PushPayload | null {
  const parts: string[] = [];
  const [first, ...rest] = written.people;
  if (first) parts.push(rest.length > 0 ? `${first}, and ${rest.length} more to contact.` : `${first}.`);
  if (written.roles.length === 1) parts.push(`One open role that fits: ${written.roles[0]}.`);
  else if (written.roles.length > 1) parts.push(`${written.roles.length} open roles that fit what you want.`);
  if (parts.length === 0) return null;
  return { title: 'Dash suggests', body: parts.join(' '), url: SUGGESTIONS_URL, tag: `job-suggestions-${day}` };
}
