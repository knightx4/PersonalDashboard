import type { PushPayload } from '@/lib/push/send';

/** Where each list is shown. */
export const PEOPLE_URL = '/jobs/contacts';
export const ROLES_URL = '/jobs/roles';

/**
 * The phone notification for a run that wrote something, or null when it
 * wrote nothing. Names the first person by their headline, since "Ask Priya
 * for a referral at Acme" is worth reading on a lock screen and a count is
 * not, and counts the rest. Opens Contacts when there are people in it and
 * Roles when there are only roles.
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
  return { title: 'Dash suggests', body: parts.join(' '), url: written.people.length > 0 ? PEOPLE_URL : ROLES_URL, tag: `job-suggestions-${day}` };
}
