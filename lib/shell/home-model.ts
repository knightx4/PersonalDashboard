import type { ModuleId } from '@/lib/modules';
import { WAITING_GROUP, type WaitingItem } from '@/lib/goals/daily';

/**
 * The pure half of the home page: the shape of an update line, how a job
 * event is worded, how the sources are merged, how "when" is said, and how
 * what Goals is waiting on is counted. The reads are in updates.ts and
 * brief.ts next door.
 */

/** How far back the feed reaches. */
export const UPDATE_WINDOW_DAYS = 3;

/** How many lines the feed shows. The rest is in each workspace. */
export const UPDATE_LIMIT = 8;

export interface Update {
  key: string;
  /** The workspace it came from; null for a watch (#1295), which belongs to none. */
  module: ModuleId | null;
  /** When it happened, as an instant. */
  at: string;
  text: string;
  detail: string | null;
  href: string | null;
}

/**
 * A job event as a sentence about the company. The database stores the kind
 * as a token, and "recruiter_reply" is not something a person says.
 */
export function jobEventLabel(
  kind: string,
  company: string,
): string {
  switch (kind) {
    case 'recruiter_reply':
      return `${company} replied`;
    case 'screen_scheduled':
      return `Screen booked with ${company}`;
    case 'interview_scheduled':
      return `Interview booked with ${company}`;
    case 'interview_completed':
      return `Interview done with ${company}`;
    case 'offer':
      return `Offer from ${company}`;
    case 'rejection':
      return `${company} said no`;
    case 'assessment_sent':
      return `${company} sent an assessment`;
    case 'assessment_submitted':
      return `Assessment sent to ${company}`;
    case 'submitted':
      return `Applied to ${company}`;
    case 'confirmation':
      return `${company} confirmed your application`;
    case 'withdrawal':
      return `Closed out ${company}`;
    case 'follow_up_sent':
      return `Followed up with ${company}`;
    default:
      return `${company}: ${kind.replace(/_/g, ' ')}`;
  }
}

/** Every source's lines as one list, newest first, capped. */
export function mergeUpdates(
  groups: readonly (readonly Update[])[],
  limit: number = UPDATE_LIMIT,
): Update[] {
  return groups
    .flat()
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, limit);
}

/**
 * When, said the way a person would: "3h ago" today, "Yesterday", then the
 * weekday. The feed only reaches back a few days, so nothing older is needed.
 */
export function whenLabel(at: string, now: Date, timezone: string): string {
  const then = new Date(at);
  const minutes = Math.max(0, Math.round((now.getTime() - then.getTime()) / 60_000));
  const day = (date: Date) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);

  const today = day(now);
  const yesterday = day(new Date(now.getTime() - 86_400_000));
  const thenDay = day(then);

  if (thenDay === today) {
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    return `${Math.floor(minutes / 60)}h ago`;
  }
  if (thenDay === yesterday) return 'Yesterday';
  return new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: timezone }).format(then);
}

/**
 * What Goals is waiting on you for, as one line: "2 to decide, 1 to approve".
 * Null when nothing is. Grouped the way the Goals page groups them, so the
 * numbers here are the headings there.
 */
export function goalsWaitingText(
  waiting: readonly Pick<WaitingItem, 'kind'>[],
): { text: string; decide: number } | null {
  const counts = { decide: 0, approve: 0, read: 0 };
  for (const item of waiting) counts[WAITING_GROUP[item.kind]] += 1;
  const parts = [
    counts.decide > 0 ? `${counts.decide} to decide` : null,
    counts.approve > 0 ? `${counts.approve} to approve` : null,
    counts.read > 0 ? `${counts.read} to read` : null,
  ].filter((part): part is string => part !== null);
  if (parts.length === 0) return null;
  return { text: `${parts.join(', ')} on your goals`, decide: counts.decide };
}
