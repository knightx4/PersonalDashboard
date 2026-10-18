/**
 * One person's pass of the finished-work notification (plan #2389.3).
 *
 * Every five minutes the job asks, for each person: has Dash stopped, and has
 * it finished anything since the last notification? When both hold, one
 * notification goes out, however many runs ended in between, saying how many
 * finished, how many failed and how many items wait in the Dev inbox
 * (lib/push/dash-finished.ts).
 *
 * - Off when the person turned the switch off (public.dash_finish_notifications
 *   .enabled). A missing row reads as on, with nothing announced yet.
 * - The first pass for a person writes `announced_through` as now and sends
 *   nothing, so runs from before the notification existed are not announced.
 * - Dash counts as working while a run is `started` and under two hours old.
 *   An older one is a session that died, and the plan writes those off as
 *   stale, so it does not hold the notification back for ever.
 * - `announced_through` moves to the latest run counted only when the send
 *   reached a device, or when there was no device to reach. A send that
 *   failed leaves it, so the same runs are announced on the next pass.
 *
 * Kept free of Supabase so it can be tested with fakes; the adapters are in
 * inngest/core/dash-finished.ts.
 */

import { dashFinishedPayload } from './dash-finished';
import { sendToPerson, type PushPorts, type PushResult } from './send';

/** A started run older than this is a dead session, not Dash at work. */
export const WORKING_HOURS = 2;

export type FinishSettings = {
  enabled: boolean;
  /** ISO time up to which ended runs have been announced; null before the first pass. */
  announcedThrough: string | null;
};

/** A run that ended: when its row last changed, and how it ended. */
export type EndedRun = { status: 'finished' | 'failed'; updatedAt: string };

export type DashFinishedPorts = {
  /** The person's row, or the defaults when there is none. */
  settings(userId: string): Promise<FinishSettings>;
  /** Whether a run is `started` and was created at or after `since`. */
  working(userId: string, since: Date): Promise<boolean>;
  /**
   * Runs finished or failed after `after` and no later than `until`, oldest
   * first, each with `updated_at` exactly as the database wrote it: the last
   * one's becomes `announced_through`, and a time rounded to milliseconds
   * would announce it again.
   */
  ended(userId: string, after: string, until: Date): Promise<EndedRun[]>;
  /** The Dev inbox count (lib/dev/inbox-count.ts). */
  inbox(userId: string): Promise<number>;
  /** Writes `announced_through`, creating the row when there is none. */
  announce(userId: string, through: string): Promise<void>;
  /** Where the person's notifications go; null when nothing can be signed. */
  push(userId: string): PushPorts | null;
};

export type DashFinishedResult =
  | { kind: 'off' }
  | { kind: 'first'; through: string }
  | { kind: 'working' }
  | { kind: 'nothing' }
  | { kind: 'unsigned' }
  | { kind: 'sent'; finished: number; failed: number; inbox: number; push: PushResult; through: string | null };

export async function runDashFinishedFor(
  ports: DashFinishedPorts,
  userId: string,
  now: Date,
): Promise<DashFinishedResult> {
  const settings = await ports.settings(userId);
  if (!settings.enabled) return { kind: 'off' };

  if (!settings.announcedThrough) {
    const through = now.toISOString();
    await ports.announce(userId, through);
    return { kind: 'first', through };
  }

  const since = new Date(now.getTime() - WORKING_HOURS * 3_600_000);
  if (await ports.working(userId, since)) return { kind: 'working' };

  const runs = await ports.ended(userId, settings.announcedThrough, now);
  if (runs.length === 0) return { kind: 'nothing' };

  // Without the signing keys the runs stay unannounced until there are some.
  const push = ports.push(userId);
  if (!push) return { kind: 'unsigned' };

  const finished = runs.filter((run) => run.status === 'finished').length;
  const failed = runs.length - finished;
  const inbox = await ports.inbox(userId);
  const result = await sendToPerson(push, userId, dashFinishedPayload({ finished, failed, inbox }), now);

  // Reached a device, or there was none to reach (every subscription gone or
  // never made): either way there is nothing to try again. Only a send that
  // failed everywhere keeps the runs for the next pass.
  const settled = result.sent > 0 || result.failed === 0;
  const latest = runs[runs.length - 1].updatedAt;
  if (settled) await ports.announce(userId, latest);

  return { kind: 'sent', finished, failed, inbox, push: result, through: settled ? latest : null };
}
