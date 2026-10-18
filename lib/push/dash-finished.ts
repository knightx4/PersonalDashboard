/**
 * The notification sent when Dash has finished its work (plan #2389).
 *
 * Pure: it takes the runs finished and failed since the last notification and
 * the Dev inbox count, and returns the push payload lib/push/send.ts sends.
 * The inbox count is countDevInbox (lib/dev/inbox-count.ts), the number on
 * the Inbox tab's badge.
 */

import { BODY_MAX, clip, TITLE_MAX } from '@/lib/day-brief/notification';
import type { PushPayload } from './send';

/** Pressing the notification opens the Dev inbox. */
export const DASH_FINISHED_URL = '/dev/inbox';

/** Fixed, so a newer notification replaces an older one still on the lock screen. */
export const DASH_FINISHED_TAG = 'dash-finished';

function things(n: number): string {
  return n === 1 ? '1 thing' : `${n} things`;
}

function inboxLine(inbox: number): string {
  if (inbox <= 0) return 'Nothing waiting in your inbox.';
  return inbox === 1 ? '1 in your inbox.' : `${inbox} in your inbox.`;
}

/**
 * The payload for a stretch of work. `finished` and `failed` are counts of
 * runs since the last notification; negative or fractional counts are floored
 * at zero. With neither, the title says only that Dash is idle.
 */
export function dashFinishedPayload(input: {
  finished: number;
  failed: number;
  inbox: number;
}): PushPayload {
  const finished = Math.max(0, Math.floor(input.finished));
  const failed = Math.max(0, Math.floor(input.failed));
  const inbox = Math.max(0, Math.floor(input.inbox));

  let title: string;
  if (finished > 0 && failed > 0) {
    title = `Dash finished ${things(finished)}, ${failed} failed.`;
  } else if (finished > 0) {
    title = `Dash finished ${things(finished)}.`;
  } else if (failed > 0) {
    title = failed === 1 ? 'A Dash run failed.' : `${failed} Dash runs failed.`;
  } else {
    title = 'Dash is idle.';
  }

  return {
    title: clip(title, TITLE_MAX),
    body: clip(inboxLine(inbox), BODY_MAX),
    url: DASH_FINISHED_URL,
    tag: DASH_FINISHED_TAG,
  };
}
