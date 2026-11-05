import { changeSentence } from '@/lib/ask/change-view';
import { planRefHref } from '@/lib/comments/refs';
import type { ProgressState } from '@/lib/plan/session-progress';
import type { DashChange } from '@/lib/talk/changes';
import type { ThreadMessage } from './chat-threads-model';

/**
 * The live card in a People thread (plan #2854.3): a small card that shows
 * only while someone on People is doing something, and says what in a line.
 *
 * Two things are live. While they are still writing the reply to your last
 * text, whatever they have already changed or proposed for it is said as one
 * working line at the foot of the thread, where their typing would be; when
 * the reply comes in it settles into the change card under it (#2854.2.1).
 * And a build you confirmed in the thread is a session that runs for an hour
 * or more, so its row on that card says where the build stands, from the
 * run's own status (public.plan_runs, the step's status, and what the session
 * last reported in core.session_progress), until it is built, stopped or
 * waiting on you.
 *
 * A plain chat draws neither. Client-safe and free of the database:
 * lib/talk/build-runs.ts reads the runs, and the thread and the gallery hand
 * them here.
 */

/** How a line reads at a glance: still going, waiting on you, finished, or stopped. */
export type LiveTone = 'working' | 'needs' | 'done' | 'failed';

/** One line of a live card: what it says, its tone, and where it leads. */
export type LiveLine = {
  tone: LiveTone;
  text: string;
  href: string;
  /**
   * The next move's words ("Answer", "Try again from its page"), or null when
   * there is none: the card's own title already links to the step.
   */
  linkLabel: string | null;
};

/** A build's run as lib/talk/build-runs.ts reads it, by the run's id. */
export type BuildRun = {
  runId: string;
  /** public.plan_runs.status: started, awaiting_input, stale, finished or failed. */
  status: string;
  /** The step's own status, which is what says it was built. */
  stepStatus: string | null;
  stopReason: string | null;
  error: string | null;
  /** What the session last reported on this run, when it has. */
  progress: { state: ProgressState; action: string; needs: string | null } | null;
};

/** The run a confirmed build started, as the change keeps it; null before Confirm, or when the run was not found. */
export function buildRunId(change: DashChange): string | null {
  if (change.kind !== 'start_build' || change.status !== 'done') return null;
  return change.writtenTable === 'public.plan_runs' ? change.writtenRef : null;
}

/** A sentence with its full stop taken off, so it can be set after a colon. */
function clause(text: string): string {
  return text.replace(/\s+/g, ' ').trim().replace(/[.\s]+$/, '');
}

/**
 * Where a confirmed build stands, as one line under the card's own
 * "Started the build of #…", so it does not name the step again. The step's status wins: a
 * built step says so whatever the run's last report was. Then a run that
 * could not start or stopped, then one waiting on you, then one going.
 */
export function buildLine(
  input: { number: number },
  run: BuildRun | null,
): LiveLine {
  const href = planRefHref(input.number);
  if (run?.stepStatus === 'done') return { tone: 'done', text: 'Built', href, linkLabel: null };
  if (!run) return { tone: 'working', text: 'Building: starting a session', href, linkLabel: null };

  const reported = run.progress;
  if (run.status === 'failed') {
    const why = run.stopReason ?? run.error;
    return {
      tone: 'failed',
      text: why ? `Stopped: ${clause(why)}` : 'Stopped before it was built',
      href,
      linkLabel: 'Try again from its page',
    };
  }
  if (run.status === 'awaiting_input' || reported?.state === 'waiting') {
    const needs = reported?.needs;
    return {
      tone: 'needs',
      text: needs ? `Needs you: ${clause(needs)}` : 'Has a question for you',
      href,
      linkLabel: 'Answer',
    };
  }
  if (run.status === 'finished' || reported?.state === 'stopped') {
    if (run.stepStatus === 'blocked') {
      return { tone: 'needs', text: `Blocked${run.stopReason ? `: ${clause(run.stopReason)}` : ''}`, href, linkLabel: null };
    }
    const why = run.stopReason ?? (reported?.state === 'stopped' ? reported.action : null);
    return {
      tone: 'failed',
      text: why ? `Stopped: ${clause(why)}` : 'Stopped before it was built',
      href,
      linkLabel: 'Try again from its page',
    };
  }
  if (run.status === 'stale') {
    return { tone: 'needs', text: 'Gone quiet: no word from the session for a while', href, linkLabel: null };
  }
  return {
    tone: 'working',
    text: reported ? `Building: ${clause(reported.action)}` : 'Building: the session has started',
    href,
    linkLabel: null,
  };
}

/**
 * The runs the thread keeps listening to: each confirmed build not read yet,
 * still going, or waiting on you (an answer sets it going again). A build
 * that was built or stopped is left alone; sending it again starts a new run
 * from its page.
 */
export function followedRuns(changes: readonly DashChange[], builds: Readonly<Record<string, BuildRun>>): string[] {
  const out: string[] = [];
  for (const change of changes) {
    const runId = buildRunId(change);
    if (!runId || change.kind !== 'start_build' || out.includes(runId)) continue;
    const run = builds[runId];
    const tone = run ? buildLine(change.input, run).tone : 'working';
    if (tone === 'working' || tone === 'needs') out.push(runId);
  }
  return out;
}

/** What they are doing while the reply to your last text is still being written. */
export type WorkingCard = {
  /** Your text it answers. */
  messageId: string;
  /** The newest thing done for it, as a sentence. */
  text: string;
  /** How many more were done before it, in the same reply. */
  more: number;
};

/** "Added the todo …"; a proposal reads as one being made, since its Confirm comes with the reply. */
function workingSentence(change: DashChange, today?: string): string {
  if (change.status !== 'proposed') return changeSentence(change, true, today);
  const sentence = changeSentence(change, false, today);
  return `Proposing: ${sentence.charAt(0).toLowerCase()}${sentence.slice(1)}`;
}

/**
 * The working card, or null. It shows only while they are typing a reply to
 * your newest text, nothing of theirs has come after it yet, and something
 * has already been done for it. Talk alone, however long, draws no card.
 */
export function workingCard(
  messages: readonly Pick<ThreadMessage, 'id' | 'role'>[],
  changes: readonly DashChange[],
  typing: boolean,
  today?: string,
): WorkingCard | null {
  if (!typing) return null;
  const last = messages.at(-1);
  if (!last || last.role !== 'person') return null;
  const done = changes.filter((change) => change.advisorMessageId === last.id);
  const newest = done.at(-1);
  if (!newest) return null;
  return { messageId: last.id, text: workingSentence(newest, today), more: done.length - 1 };
}
