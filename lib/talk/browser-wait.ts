import type { FireSessionResult } from './handoff-fire';
import type { SessionHandoff } from './handoffs';

/**
 * The minute sweep behind a browser task's wait (plan #3040.4, under #3040).
 *
 * A bot's browser task is kept pending and not started (fireSessionHandoff,
 * lib/talk/handoff-fire.ts), so the runner on the person's PC or Mac can
 * claim it and do it in their own Chrome. Every minute this pass:
 *
 * 1. lets go of any claim whose computer has gone quiet: claimed over 5
 *    minutes ago by a computer with no heartbeat in 5 minutes
 *    (core.release_stale_browser_claims, migration 0313). Such a task has
 *    waited past the 3 minutes already, so step 2 starts it in the cloud;
 * 2. starts the cloud session on every browser task still pending and
 *    unclaimed BROWSER_WAIT_MS after it was kept. The fire claims the row
 *    only where claimed_by is still null, so a computer that claims it in
 *    the meantime keeps it;
 * 3. says so in the thread: no computer of theirs took it, so it runs on
 *    public pages only. A start that fails says why instead, since nobody
 *    else is left to tell the thread.
 *
 * This file has no database; inngest/core/browser-wait.ts binds the ports.
 */

/** Said in the thread when the cloud session starts on a browser task. */
export const CLOUD_FALLBACK_LINE =
  "None of your computers picked this up within 3 minutes, so I've started it in the cloud. It can only use public pages there, not sites you're signed in to.";

/** Said in the thread when the cloud session would not start either. */
export function cloudFailedLine(error: string | null): string {
  const why = (error ?? '').trim();
  return `None of your computers picked this up within 3 minutes, and the cloud session would not start${why ? `: ${why.replace(/[.\s]+$/, '')}` : ''}. Nothing has been done with it.`;
}

export type BrowserWaitPorts = {
  /** Lets go of claims whose computer has gone quiet; how many. */
  releaseStale: () => Promise<number>;
  /** The pending, unclaimed browser tasks kept at or before this time. */
  waited: (keptBy: string) => Promise<SessionHandoff[]>;
  /** Starts the cloud session after the wait (fireSessionHandoff with afterWait). */
  fire: (handoff: SessionHandoff) => Promise<FireSessionResult>;
  /** Posts one line into the thread the hand-off was asked in. */
  say: (handoff: SessionHandoff, text: string) => Promise<void>;
};

export type BrowserWaitResult = {
  released: number;
  started: string[];
  failed: string[];
  /** Taken by a computer, or by another sweep, between the read and the fire. */
  skipped: string[];
};

export async function runBrowserWait(
  ports: BrowserWaitPorts,
  now: Date,
  waitMs: number,
): Promise<BrowserWaitResult> {
  const released = await ports.releaseStale();
  const keptBy = new Date(now.getTime() - waitMs).toISOString();
  const result: BrowserWaitResult = { released, started: [], failed: [], skipped: [] };
  for (const handoff of await ports.waited(keptBy)) {
    let fired: FireSessionResult;
    try {
      fired = await ports.fire(handoff);
    } catch (error) {
      console.error('the browser task was not started', error);
      result.failed.push(handoff.id);
      continue;
    }
    let line: string | null = null;
    if (fired.started) {
      result.started.push(handoff.id);
      line = CLOUD_FALLBACK_LINE;
    } else if (fired.state === 'failed') {
      result.failed.push(handoff.id);
      line = cloudFailedLine(fired.error);
    } else {
      result.skipped.push(handoff.id);
    }
    if (line) {
      try {
        await ports.say(handoff, line);
      } catch (error) {
        console.error('the thread was not told about the browser task', error);
      }
    }
  }
  return result;
}
