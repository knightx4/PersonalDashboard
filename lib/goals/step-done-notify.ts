/**
 * The phone message sent when Dash closes a step the person asked to hear
 * about (plan #2376.3, feature #2376).
 *
 * A step carries `notify_on_done` (goals 0083). When Dash closes such a step
 * as done, one notification goes out with the step's title and the first
 * sentence of what Dash wrote, and pressing it opens the step.
 * `notified_at` is the send-once guard: a step is sent only while it is
 * empty, and the pass sets it before sending, so two passes that overlap
 * cannot both send. A send that reached no device and failed on at least one
 * clears it again, so the next pass tries once more.
 *
 * Only steps closed in the last six hours are sent. An older close is one
 * from before the switch was turned on, or one the job missed while it was
 * down, and a message hours late reads as news it no longer is.
 *
 * Kept free of Supabase so it can be tested with fakes; the adapters are in
 * inngest/goals/step-done-notify.ts.
 */

import { BODY_MAX, clip, TITLE_MAX } from '@/lib/day-brief/notification';
import { stepHref } from '@/lib/goals/all-goals';
import { sendToPerson, type PushPayload, type PushPorts, type PushResult } from '@/lib/push/send';

/** A close older than this is not announced. */
export const NOTIFY_WINDOW_HOURS = 6;

/** A flagged Dash step closed as done and not yet announced. */
export type DoneStep = {
  id: string;
  userId: string;
  title: string;
  /** Dash's closing text (goals.items.result); its first sentence is the body. */
  result: string | null;
  /** The goal the step sits under, for the link; null when it cannot be found. */
  goalId: string | null;
};

/**
 * The first sentence of Dash's closing text. Dash opens every result with one
 * plain sentence (plan #2376.4); a heading or list marker in front of it is
 * dropped, and a result that is all one run-on line is clipped by the caller.
 */
export function firstSentence(text: string | null | undefined): string {
  if (!text) return '';
  const line = text
    .split('\n')
    .map((l) => l.replace(/^\s*(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s*)/, '').replace(/[*_`]/g, '').trim())
    .find((l) => l.length > 0);
  if (!line) return '';
  const match = line.match(/^.+?[.?!](?=\s|$)/);
  return (match ? match[0] : line).trim();
}

export function stepDonePayload(step: DoneStep): PushPayload {
  return {
    title: clip(step.title, TITLE_MAX),
    // A step with nothing written sends its title alone.
    body: clip(firstSentence(step.result), BODY_MAX),
    url: step.goalId ? stepHref(step.goalId, step.id) : '/goals',
    // The step's own tag, so a repeat replaces rather than stacks.
    tag: `goal-step-${step.id}`,
  };
}

export type StepDonePorts = {
  /**
   * Flagged Dash steps closed as done at or after `since` with `notified_at`
   * still empty, across everyone. Each row names its person.
   */
  due(since: Date): Promise<DoneStep[]>;
  /**
   * Sets `notified_at` on the step if it is still empty, scoped to its
   * person. True when this call set it, false when another pass got there.
   */
  claim(step: DoneStep, at: Date): Promise<boolean>;
  /** Clears `notified_at` again after a send that reached nothing. */
  release(step: DoneStep): Promise<void>;
  /** Where the person's notifications go; null when nothing can be signed. */
  push(userId: string): PushPorts | null;
};

export type StepDoneOutcome =
  | { stepId: string; kind: 'sent'; push: PushResult }
  | { stepId: string; kind: 'retry'; push: PushResult }
  | { stepId: string; kind: 'taken' }
  | { stepId: string; kind: 'unsigned' };

export type StepDoneSummary = { steps: number; outcomes: StepDoneOutcome[]; failed: string[] };

export async function runStepDoneNotify(ports: StepDonePorts, now: Date): Promise<StepDoneSummary> {
  const since = new Date(now.getTime() - NOTIFY_WINDOW_HOURS * 3_600_000);
  const steps = await ports.due(since);
  const summary: StepDoneSummary = { steps: steps.length, outcomes: [], failed: [] };

  for (const step of steps) {
    try {
      // Without the signing keys the step stays unsent, and is tried while
      // it is still inside the window.
      const push = ports.push(step.userId);
      if (!push) {
        summary.outcomes.push({ stepId: step.id, kind: 'unsigned' });
        continue;
      }
      if (!(await ports.claim(step, now))) {
        summary.outcomes.push({ stepId: step.id, kind: 'taken' });
        continue;
      }
      let result: PushResult;
      try {
        result = await sendToPerson(push, step.userId, stepDonePayload(step), now);
      } catch (err) {
        await ports.release(step);
        throw err;
      }
      // Reached a device, or there was none to reach: done either way. A
      // send that failed everywhere gives the step back for the next pass.
      if (result.sent === 0 && result.failed > 0) {
        await ports.release(step);
        summary.outcomes.push({ stepId: step.id, kind: 'retry', push: result });
      } else {
        summary.outcomes.push({ stepId: step.id, kind: 'sent', push: result });
      }
    } catch (err) {
      summary.failed.push(err instanceof Error ? err.message : String(err));
    }
  }
  return summary;
}
