/**
 * Whether main is green, as the status line draws it.
 *
 * The reading itself is taken by the overnight tick and stored in
 * `plan_main_checks` (`lib/plan/ci.ts` `refreshMainCheck`). This file is the
 * other half: what a stored row means, what colour it is, and what it says
 * when you hover it. Pure and separate from `ci.ts` for the same reason
 * `checks.ts` is -- the fetching is server-only and the dot is drawn in the
 * browser.
 *
 * `CheckConclusion` is reused rather than a second enum being invented for
 * main. Four of its five values can happen here; `unmerged` cannot, because it
 * means "nothing on main carries this commit" and this commit *is* main.
 */
import type { CheckConclusion } from './checks';

/** One stored reading of main's newest commit. */
export type MainCheck = {
  /** Main's newest commit when GitHub was asked. Null when GitHub would not say. */
  sha: string | null;
  /** What CI made of it. Null when the reading did not get that far. */
  conclusion: CheckConclusion | null;
  /** When GitHub was asked, ISO. Written on every attempt, answered or not. */
  checkedAt: string;
  /** Why GitHub refused, in the sentence `refusalFor` writes. Null when it answered. */
  error: string | null;
  /**
   * Why main failed, in the sentence `failureReason` writes: which job and
   * step broke, or that GitHub never started the jobs. Null unless failed, and
   * null on a failure whose jobs could not be read.
   */
  reason: string | null;
  /** The failing run on GitHub, for the panel to link to. Null unless failed. */
  runUrl: string | null;
};

/** One job of a failing workflow run, as `/actions/runs/{id}/jobs` gives it. */
export type FailedJob = {
  name: string;
  conclusion: string | null;
  /** Zero or null when GitHub never gave the job a machine to run on. */
  runner_id?: number | null;
  steps?: Array<{ name: string; conclusion: string | null }>;
};

/** One failing workflow run and the jobs under it. */
export type FailedRun = { name: string; conclusion: string | null; jobs: FailedJob[] };

/** The job conclusions that count as broken, the same set `checks.ts` fails on. */
const BROKEN = new Set(['failure', 'timed_out', 'cancelled', 'startup_failure', 'action_required']);

/**
 * Why main is red, in one or two sentences for the panel behind the dot.
 *
 * Two different failures look identical from the conclusion alone, and they
 * want different people. A job that ran and broke at a step is the code: the
 * sentence names the job and the step, which is where the log starts to
 * matter. A job GitHub never started has no steps and was never given a
 * runner, and no push can fix it: on a private repository that is almost
 * always the month's Actions minutes used up or a payment that failed, so the
 * sentence says that and where to look, rather than sending somebody into
 * logs that do not exist.
 *
 * Null when there is nothing to say beyond "failed", which the panel already
 * says.
 */
export function failureReason(runs: readonly FailedRun[]): string | null {
  const broke: string[] = [];
  const unstarted: string[] = [];
  let unstartedRun = false;

  for (const run of runs) {
    const failing = run.jobs.filter((job) => job.conclusion && BROKEN.has(job.conclusion));
    // A run that failed before it had any jobs is a workflow GitHub could not
    // start at all: a broken workflow file, or the same billing refusal.
    if (run.jobs.length === 0 && run.conclusion && BROKEN.has(run.conclusion)) {
      unstartedRun = true;
      continue;
    }
    for (const job of failing) {
      const steps = job.steps ?? [];
      if (steps.length === 0 && !job.runner_id) {
        unstarted.push(job.name);
        continue;
      }
      const step = steps.find((s) => s.conclusion && BROKEN.has(s.conclusion));
      broke.push(step ? `${job.name} › ${step.name}` : job.name);
    }
  }

  const said: string[] = [];
  if (broke.length > 0) said.push(`Failed at ${broke.join(', ')}.`);
  if (unstarted.length > 0) {
    said.push(
      `GitHub never started ${unstarted.join(', ')}: no runner was given ${
        unstarted.length === 1 ? 'to it' : 'to them'
      }, which on a private repository usually means the month's Actions minutes are used up or a payment failed. Check github.com/settings/billing.`,
    );
  } else if (unstartedRun) {
    said.push(
      "GitHub could not start the workflow at all: either the workflow file is invalid or the account's Actions minutes or billing stopped it. The run on GitHub says which.",
    );
  }

  if (said.length === 0) return null;
  // The column holds 500 characters; a run with a dozen broken jobs is still
  // one reason, and the link beside it has the rest.
  const text = said.join(' ');
  return text.length > 500 ? `${text.slice(0, 497)}...` : text;
}

/**
 * The four states the dot can be in, which is fewer than the conclusions.
 *
 * `none` -- main's head ran no workflows at all -- collapses into `unknown`
 * rather than into `passed`. `conclusionFrom` folds neutral and skipped runs
 * into a pass because GitHub's own summary does, but "no checks exist" is not
 * evidence that anything is well, and a green dot is a claim.
 */
export type MainDot = 'passed' | 'failed' | 'running' | 'unknown';

/**
 * How old a reading may be before the dot stops standing behind it.
 *
 * The tick runs every four minutes, all day and not only at night -- the
 * pg_cron schedule in migration 0078 -- so an ordinary reading is somewhere
 * between nought and four minutes old.
 * Six is that plus a tick that took its time. Past it the dot goes grey and
 * says how old the reading is, because a green dot left over from an hour ago
 * is not a stale fact, it is a false one -- which is the exact failure this
 * whole thing exists to stop: main was red for two hours and nothing said so.
 */
export const MAIN_CHECK_STALE_MINUTES = 6;

/** Whether a reading is too old to draw a colour from. */
export function mainCheckStale(check: MainCheck, now: number): boolean {
  const at = new Date(check.checkedAt).getTime();
  // An unparseable timestamp is not a fresh one. Better grey than a guess.
  if (!Number.isFinite(at)) return true;
  return (now - at) / 60_000 >= MAIN_CHECK_STALE_MINUTES;
}

/**
 * The colour to draw, given what is stored and what time it is here.
 *
 * `now` is null before the component has mounted. Ages are the reader's own
 * clock and the server has no business guessing at them, so pre-mount the
 * stored conclusion is drawn as it stands and the staleness test is simply not
 * applied yet -- which is the same shape `Timestamp` has always had in this
 * bar, and it means the dot does not change size or position on hydration.
 */
export function mainDot(check: MainCheck | null, now: number | null): MainDot {
  if (!check || !check.conclusion) return 'unknown';
  if (now !== null && mainCheckStale(check, now)) return 'unknown';
  switch (check.conclusion) {
    case 'passed':
      return 'passed';
    case 'failed':
      return 'failed';
    case 'running':
      return 'running';
    default:
      return 'unknown';
  }
}

/** Seven characters, which is what a commit is called everywhere else here. */
function short(sha: string): string {
  return sha.slice(0, 7);
}

/** What each conclusion is called in the sentence below. */
const SAYS: Record<CheckConclusion, string> = {
  passed: 'passed its checks',
  failed: 'failed its checks',
  running: 'is still being checked',
  none: 'ran no checks at all',
  // Cannot happen for main's own head; here so the record is total and a sixth
  // conclusion fails the typecheck rather than drawing as a blank.
  unmerged: 'is not on main',
};

/**
 * The sentence the dot carries: its hover title, and the word a screen reader
 * is given for it.
 *
 * Colour is not a state, so this is the state. It names the commit and when it
 * was read, which is what makes a dot worth trusting rather than merely worth
 * looking at, and it is one sentence because it is a `title` -- nobody reads a
 * paragraph out of a tooltip.
 *
 * `at` is the reading's time already formatted on the reader's machine, or
 * null before mount. Formatting is left to the caller so nothing here has to
 * know about locales or time zones, which is also what keeps it testable.
 */
export function mainCheckTitle(
  check: MainCheck | null,
  now: number | null,
  at: string | null,
): string {
  if (!check) return 'CI on main has not been read yet.';

  const when = at ? ` Read at ${at}.` : '';

  if (check.error) {
    // Already a sentence, and already addressed to the person who can fix it
    // -- `refusalFor` is the #566 convention. Repeating it is the whole point.
    return `Main's CI could not be read. ${check.error}${when}`;
  }

  const commit = check.sha ? `main ${short(check.sha)}` : 'main';
  const said = SAYS[check.conclusion ?? 'none'];

  if (now !== null && mainCheckStale(check, now)) {
    const minutes = Math.max(1, Math.round((now - new Date(check.checkedAt).getTime()) / 60_000));
    return `${commit} ${said}, but that was ${minutes} minutes ago and nothing has read it since.`;
  }

  return `${commit} ${said}.${when}`;
}

/**
 * What each colour means, for the panel behind the dot.
 *
 * The sentence above says what this particular reading is; these say what the
 * four colours are, which is the thing a dot cannot tell you and a hover title
 * has no room for. Written as the state rather than as an instruction, in the
 * same machine voice as the line they sit in.
 *
 * `unknown` carries its four causes because it is the one that looks like a
 * fault and usually is not: nothing read yet, GitHub refusing, a reading gone
 * stale, and a commit no workflow touched all land on grey.
 */
export const MAIN_DOT_MEANING: Record<MainDot, string> = {
  passed: 'Green: main built and its checks passed.',
  failed: 'Red: a check on main failed. This is the one worth acting on.',
  running: 'Amber: main is still being checked.',
  unknown:
    'Grey: nothing is known. Not read yet, GitHub would not say, the reading is over six minutes old, or main ran no checks.',
};

/** The colours in the order the panel lists them: best news first. */
export const MAIN_DOT_ORDER: readonly MainDot[] = ['passed', 'running', 'failed', 'unknown'];
