import {
  notBuiltReason,
  PREPARATION_STEP_LABELS,
  PREPARATION_STEPS,
  type PreparationStatus,
  type PreparationStepKey,
  type PreparationStepStatus,
} from './steps';
import type { PreparationBranch } from './branch';

/**
 * The preparation runner (plan #2276.1).
 *
 * Goes down a subject's seven steps in order. Each step is a function that is
 * safe to call again: it reads what earlier calls wrote and carries on. A call
 * works until its budget is nearly spent, then stops between steps (or between
 * two calls of one step) and leaves the run where the next call picks it up.
 *
 * The resume contract, which every step written later keeps:
 *   - A step returns `done` when it has nothing left to do, `more` when it
 *     made progress and wants calling again, or `skipped` with a reason.
 *   - A step reads `ctx.deadline` and returns `more` before it, rather than
 *     starting work it cannot finish. What it has written stays written.
 *     A step whose next piece of work is one call too long for the time left
 *     returns `more` with `pause`, which ends this call so the next one starts
 *     the step with a full budget.
 *   - A step that throws fails the run. The next call (Continue on the page,
 *     or the daily cron) starts again at that step.
 *   - A step with no handler yet is skipped with the plan step that builds it.
 *
 * Pure apart from its ports, so the tests run a whole preparation with an
 * in-memory store, a fake clock and no network. The database half is
 * store.ts; the call that works a run in its own function is
 * inngest/learn/prepare.ts.
 */

export type PreparationStepRow = {
  key: PreparationStepKey;
  ordinal: number;
  status: PreparationStepStatus;
  startedAt: string | null;
  finishedAt: string | null;
  summary: string | null;
  counts: Record<string, number>;
  /** What the step found, as its own code shapes it (documents stored, weeks matched). */
  detail?: Record<string, unknown>;
  calls: number;
  error: string | null;
};

export type PreparationRow = {
  id: string;
  userId: string;
  subjectId: string;
  status: PreparationStatus;
  currentStep: PreparationStepKey | null;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  failures: number;
  /** The branch a second run prepares alone (plan #2276.7); null or absent on the subject's own run. */
  branch?: PreparationBranch | null;
};

export type PreparedSubject = {
  id: string;
  userId: string;
  name: string;
  note: string | null;
  kind: string | null;
  /** Set on a branch run: the steps aim beneath it (searchSubject in branch.ts). */
  branch?: PreparationBranch | null;
};

/** A run held by this call, with its steps in order and the subject it prepares. */
export type ClaimedPreparation = {
  run: PreparationRow;
  steps: PreparationStepRow[];
  subject: PreparedSubject;
};

export type StepOutcome =
  | { state: 'done'; summary?: string; counts?: Record<string, number>; detail?: Record<string, unknown> }
  | {
      state: 'more';
      summary?: string;
      counts?: Record<string, number>;
      detail?: Record<string, unknown>;
      /**
       * End this call here and carry on in the next one: for a step whose
       * one piece of work (a long model call) will not fit in the time left.
       */
      pause?: boolean;
    }
  | { state: 'skipped'; reason: string; detail?: Record<string, unknown> };

export type StepContext = {
  subject: PreparedSubject;
  run: PreparationRow;
  /** This step's row as it stands, with what earlier calls recorded. */
  step: PreparationStepRow;
  /** Every step's row, keyed, for a step that reads what an earlier one found. */
  steps: ReadonlyMap<PreparationStepKey, PreparationStepRow>;
  /** Epoch ms by which the step must return. */
  deadline: number;
  now: () => number;
};

export type StepHandler = (ctx: StepContext) => Promise<StepOutcome>;

export type StepPatch = Partial<Omit<PreparationStepRow, 'key' | 'ordinal'>>;
export type RunPatch = Partial<Omit<PreparationRow, 'id' | 'userId' | 'subjectId'>> & { leaseUntil?: string | null };

export type PreparationPorts = {
  /**
   * Take the run for this call until `leaseUntil`: null when another call
   * holds it or there is no run. A finished run is returned as it is.
   * `branch` names a branch run by its key (plan #2276.7); null or absent is
   * the subject's own run.
   */
  claim: (subjectId: string, leaseUntil: string, branch?: string | null) => Promise<ClaimedPreparation | null>;
  saveRun: (runId: string, patch: RunPatch) => Promise<void>;
  saveStep: (runId: string, key: PreparationStepKey, patch: StepPatch) => Promise<void>;
  handlers: Partial<Record<PreparationStepKey, StepHandler>>;
  now: () => number;
};

export type PreparationResult =
  /** Every step is done or skipped. */
  | { outcome: 'finished'; ran: PreparationStepKey[] }
  /** The budget ran out; the next call carries on at `step`. */
  | { outcome: 'paused'; step: PreparationStepKey; ran: PreparationStepKey[] }
  /** A step threw; Continue or the cron starts again at it. */
  | { outcome: 'failed'; step: PreparationStepKey; error: string; ran: PreparationStepKey[] }
  /** Another call holds the run, or the subject has none. */
  | { outcome: 'busy' };

/** Four minutes, under Vercel's five, leaving the hand-off its share. */
export const PREPARE_BUDGET_MS = 240_000;
/** A step is not started with less than this left. */
export const MIN_STEP_MS = 20_000;
/** The lease outlives the budget, so a killed call frees the run soon after. */
const LEASE_MARGIN_MS = 60_000;
const ERROR_MAX = 500;
const SUMMARY_MAX = 300;

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** The step a run would work next: the first not done or skipped, in order. */
export function nextStep(steps: readonly PreparationStepRow[]): PreparationStepRow | null {
  return [...steps].sort((a, b) => a.ordinal - b.ordinal).find((s) => s.status !== 'done' && s.status !== 'skipped') ?? null;
}

/** The finish step: says how long the preparation took. */
export const finishStep: StepHandler = async (ctx) => {
  const started = ctx.run.startedAt ? Date.parse(ctx.run.startedAt) : ctx.now();
  const seconds = Math.max(0, Math.round((ctx.now() - started) / 1000));
  const minutes = Math.max(1, Math.round(seconds / 60));
  return { state: 'done', summary: `Prepared in ${minutes} minute${minutes === 1 ? '' : 's'}.`, counts: { seconds } };
};

export async function runPreparation(
  ports: PreparationPorts,
  subjectId: string,
  options: { budgetMs?: number; minStepMs?: number; branch?: string | null } = {},
): Promise<PreparationResult> {
  const budget = options.budgetMs ?? PREPARE_BUDGET_MS;
  const minStep = Math.min(options.minStepMs ?? MIN_STEP_MS, budget);
  const started = ports.now();
  const deadline = started + budget;

  const claimed = await ports.claim(subjectId, iso(deadline + LEASE_MARGIN_MS), options.branch ?? null);
  if (!claimed) return { outcome: 'busy' };
  const { subject } = claimed;
  const run: PreparationRow = { ...claimed.run };
  const steps = new Map<PreparationStepKey, PreparationStepRow>(claimed.steps.map((s) => [s.key, { ...s }]));
  const ran: PreparationStepKey[] = [];

  if (run.status === 'done') {
    await ports.saveRun(run.id, { leaseUntil: null });
    return { outcome: 'finished', ran };
  }

  const startRun: RunPatch = { status: 'running', error: null };
  if (!run.startedAt) startRun.startedAt = iso(started);
  Object.assign(run, startRun);
  await ports.saveRun(run.id, startRun);

  for (;;) {
    const step = nextStep([...steps.values()]);
    if (!step) break;

    if (ports.now() + minStep > deadline) {
      await ports.saveRun(run.id, { currentStep: step.key, leaseUntil: null });
      return { outcome: 'paused', step: step.key, ran };
    }

    const begin: StepPatch = { status: 'running', error: null };
    if (!step.startedAt) begin.startedAt = iso(ports.now());
    Object.assign(step, begin);
    if (run.currentStep !== step.key) {
      run.currentStep = step.key;
      await ports.saveRun(run.id, { currentStep: step.key });
    }
    await ports.saveStep(run.id, step.key, begin);
    if (!ran.includes(step.key)) ran.push(step.key);

    const handler = ports.handlers[step.key];
    let outcome: StepOutcome;
    if (!handler) {
      outcome = { state: 'skipped', reason: notBuiltReason(step.key) };
    } else {
      try {
        outcome = await handler({ subject, run, step: { ...step }, steps, deadline, now: ports.now });
      } catch (error) {
        const message = clip(error instanceof Error ? error.message : String(error), ERROR_MAX);
        const failedStep: StepPatch = { status: 'failed', error: message, calls: step.calls + 1 };
        Object.assign(step, failedStep);
        await ports.saveStep(run.id, step.key, failedStep);
        await ports.saveRun(run.id, {
          status: 'failed',
          error: clip(`${PREPARATION_STEP_LABELS[step.key].label}: ${message}`, ERROR_MAX),
          failures: run.failures + 1,
          leaseUntil: null,
        });
        return { outcome: 'failed', step: step.key, error: message, ran };
      }
    }

    const patch: StepPatch =
      outcome.state === 'skipped'
        ? {
            status: 'skipped',
            summary: clip(outcome.reason, SUMMARY_MAX),
            finishedAt: iso(ports.now()),
            ...(outcome.detail !== undefined ? { detail: outcome.detail } : {}),
          }
        : {
            status: outcome.state === 'done' ? 'done' : 'running',
            calls: step.calls + (handler ? 1 : 0),
            ...(outcome.summary !== undefined ? { summary: clip(outcome.summary, SUMMARY_MAX) } : {}),
            ...(outcome.counts !== undefined ? { counts: outcome.counts } : {}),
            ...(outcome.detail !== undefined ? { detail: outcome.detail } : {}),
            ...(outcome.state === 'done' ? { finishedAt: iso(ports.now()) } : {}),
          };
    Object.assign(step, patch);
    await ports.saveStep(run.id, step.key, patch);
    if (outcome.state === 'more' && outcome.pause) {
      await ports.saveRun(run.id, { leaseUntil: null });
      return { outcome: 'paused', step: step.key, ran };
    }
  }

  await ports.saveRun(run.id, {
    status: 'done',
    currentStep: null,
    finishedAt: iso(ports.now()),
    error: null,
    leaseUntil: null,
  });
  return { outcome: 'finished', ran };
}

/** The steps in order, for a run row read back with none (a subject from before the trigger). */
export function freshSteps(): PreparationStepRow[] {
  return PREPARATION_STEPS.map((key, i) => ({
    key,
    ordinal: i + 1,
    status: 'pending',
    startedAt: null,
    finishedAt: null,
    summary: null,
    counts: {},
    calls: 0,
    error: null,
  }));
}
