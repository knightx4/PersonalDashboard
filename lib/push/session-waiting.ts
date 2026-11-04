/**
 * The phone notification for a session that stopped to ask the person
 * something (plan #2800.4).
 *
 * A session reports `waiting` with what it needs (lib/plan/session-progress.ts).
 * Every minute the job finds the rows waiting that the phone has not been told
 * about (core.session_progress.notified_at, cleared by the database whenever a
 * wait starts or asks something new) and sends one notification for each.
 * Only questions and jobs for the person go out; a session that is working or
 * done never does, so progress stays on the project page and Dev.
 *
 * Kept free of Supabase so it can be tested with fakes; the adapter is in
 * inngest/core/session-waiting.ts. The send is lib/push/send.ts, the path
 * the finished-work notification uses.
 */

import { BODY_MAX, clip, TITLE_MAX } from '@/lib/day-brief/notification';
import { sendToPerson, type PushPayload, type PushPorts, type PushResult } from './send';

/** Pressing the notification opens the Goals Inbox, where the question is answered. */
export const SESSION_WAITING_URL = '/goals/inbox';

/** A wait older than this is a session that left; it is neither announced nor listed. */
export const WAITING_DAYS = 3;

/** The most announced in one pass; the rest go out on the next. */
export const PER_PASS = 5;

export type WaitingSession = {
  id: string;
  userId: string;
  /** What it is on: a step's outline and title, a project, or the session's own line. */
  about: string;
  needs: string;
};

export function sessionWaitingPayload(row: Pick<WaitingSession, 'id' | 'about' | 'needs'>): PushPayload {
  return {
    title: clip(`Dash needs your answer: ${row.about}`, TITLE_MAX),
    body: clip(row.needs, BODY_MAX),
    url: SESSION_WAITING_URL,
    // One per row, so two questions stack rather than the second replacing the first.
    tag: `session-waiting-${row.id}`,
  };
}

export type SessionWaitingPorts = {
  /** Rows waiting and not yet announced, updated at or after `since`, oldest first. */
  unannounced(since: Date, limit: number): Promise<WaitingSession[]>;
  /** Sets notified_at on these rows. */
  announce(ids: string[], at: Date): Promise<void>;
  /** Where one person's notifications go; null when nothing can be signed. */
  push(userId: string): PushPorts | null;
};

export type SessionWaitingResult = { announced: number; unsigned: number; failed: number };

export async function runSessionWaiting(ports: SessionWaitingPorts, now: Date): Promise<SessionWaitingResult> {
  const since = new Date(now.getTime() - WAITING_DAYS * 86_400_000);
  const rows = await ports.unannounced(since, PER_PASS);
  const result: SessionWaitingResult = { announced: 0, unsigned: 0, failed: 0 };
  const settled: string[] = [];

  for (const row of rows) {
    const push = ports.push(row.userId);
    // Without the signing keys the rows stay unannounced until there are some.
    if (!push) {
      result.unsigned += 1;
      continue;
    }
    let sent: PushResult;
    try {
      sent = await sendToPerson(push, row.userId, sessionWaitingPayload(row), now);
    } catch {
      result.failed += 1;
      continue;
    }
    // Reached a device, or there was none to reach: nothing to try again.
    // Only a send that failed everywhere is left for the next pass.
    if (sent.sent > 0 || sent.failed === 0) {
      settled.push(row.id);
      result.announced += 1;
    } else {
      result.failed += 1;
    }
  }
  if (settled.length > 0) await ports.announce(settled, now);
  return result;
}
