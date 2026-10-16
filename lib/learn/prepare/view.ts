import type { PreparationRow, PreparationStepRow } from './run';
import { PREPARATION_STEP_LABELS, type PreparationStepKey } from './steps';

/**
 * What the subject page draws from a preparation run (plan #2276.2).
 *
 * Pure, so the page and its gallery drawings read the same lines, and the
 * tests can walk a run through every stage without a database.
 *
 * Four shapes: no run at all (a subject made before preparation existed,
 * which the page offers to prepare), a run working, a run stopped on a failed
 * step, and a finished run, which the page folds to one line.
 */

/**
 * How a step's line reads. `current` is the step being worked now, or the
 * one the run starts on when it has not begun: the runner marks a step
 * running only once a call reaches it, and the page should not show a fresh
 * run with nothing happening.
 */
export type PreparationLineState = 'done' | 'current' | 'pending' | 'skipped' | 'failed';

export type PreparationLine = {
  key: PreparationStepKey;
  label: string;
  state: PreparationLineState;
  /** What it found, what it is doing, or why it stopped; null for a step still to come. */
  detail: string | null;
};

export type PreparationView =
  | { kind: 'none' }
  | { kind: 'working'; lines: PreparationLine[]; position: number; total: number; starting: boolean }
  | { kind: 'failed'; lines: PreparationLine[]; position: number; total: number }
  | { kind: 'finished'; summary: string };

/** The words a count is shown with. A key not listed here is shown with its own name. */
const COUNT_WORDS: Record<string, [one: string, many: string]> = {
  documents: ['document stored', 'documents stored'],
  weeks: ['week matched', 'weeks matched'],
  topics: ['topic drafted', 'topics drafted'],
  units: ['unit written', 'units written'],
};

/** Counts that are bookkeeping, not something the step found. */
const HIDDEN_COUNTS = new Set(['seconds', 'calls']);

/** "4 documents stored, 31 topics drafted", or null when there is nothing to count. */
export function countsLine(counts: Record<string, number>): string | null {
  const parts = Object.entries(counts)
    .filter(([key, n]) => !HIDDEN_COUNTS.has(key) && Number.isFinite(n))
    .map(([key, n]) => {
      const words = COUNT_WORDS[key] ?? [key.replace(/_/g, ' '), key.replace(/_/g, ' ')];
      return `${n} ${n === 1 ? words[0] : words[1]}`;
    });
  return parts.length > 0 ? parts.join(', ') : null;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** How long a run took, from its start to its finish: "6 minutes", "1 hour 5 minutes". */
export function tookLine(startedAt: string | null, finishedAt: string | null): string | null {
  if (!startedAt || !finishedAt) return null;
  const ms = Date.parse(finishedAt) - Date.parse(startedAt);
  if (!Number.isFinite(ms) || ms < 0) return null;
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return plural(minutes, 'minute');
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? plural(hours, 'hour') : `${plural(hours, 'hour')} ${plural(rest, 'minute')}`;
}

function lineFor(step: PreparationStepRow, current: boolean, starting: boolean): PreparationLine {
  const label = PREPARATION_STEP_LABELS[step.key].label;
  if (step.status === 'done') {
    return { key: step.key, label, state: 'done', detail: step.summary ?? countsLine(step.counts) ?? 'Done.' };
  }
  if (step.status === 'skipped') {
    return { key: step.key, label, state: 'skipped', detail: step.summary ?? 'Skipped.' };
  }
  if (step.status === 'failed') {
    return { key: step.key, label, state: 'failed', detail: step.error ?? 'This step stopped without saying why.' };
  }
  if (step.status === 'running' || current) {
    const found = step.summary ?? countsLine(step.counts);
    return {
      key: step.key,
      label,
      state: 'current',
      detail: found ?? (starting ? 'Starting in a moment.' : 'Working on it.'),
    };
  }
  return { key: step.key, label, state: 'pending', detail: null };
}

/**
 * The page's reading of a run. `null` is a subject with no run, which only a
 * subject made before preparation existed has.
 */
export function preparationView(
  prep: { run: PreparationRow; steps: PreparationStepRow[] } | null,
): PreparationView {
  if (!prep) return { kind: 'none' };
  const { run } = prep;
  const steps = [...prep.steps].sort((a, b) => a.ordinal - b.ordinal);
  const total = steps.length;

  if (run.status === 'done') {
    const took = tookLine(run.startedAt, run.finishedAt);
    const found = countsLine(
      steps.reduce<Record<string, number>>((all, step) => {
        for (const [key, n] of Object.entries(step.counts)) all[key] = (all[key] ?? 0) + n;
        return all;
      }, {}),
    );
    const head = took ? `Prepared in ${took}` : 'Prepared';
    return { kind: 'finished', summary: found ? `${head} · ${found}` : head };
  }

  // The step to mark: the one the run names, else the first not finished.
  const open = steps.find((s) => s.status !== 'done' && s.status !== 'skipped') ?? null;
  const currentKey =
    run.status === 'failed'
      ? (steps.find((s) => s.status === 'failed')?.key ?? run.currentStep ?? open?.key ?? null)
      : (run.currentStep && steps.some((s) => s.key === run.currentStep && s.status !== 'done' && s.status !== 'skipped')
          ? run.currentStep
          : (open?.key ?? null));
  const starting = run.status === 'pending' || !run.startedAt;
  const position = Math.max(1, steps.findIndex((s) => s.key === currentKey) + 1);

  if (run.status === 'failed') {
    const lines = steps.map((s) => {
      // A run that failed with no step marked failed still says why, on the step it stopped at.
      if (s.key === currentKey && s.status !== 'failed') {
        return { ...lineFor(s, false, false), state: 'failed' as const, detail: run.error ?? 'This step stopped without saying why.' };
      }
      return lineFor(s, false, false);
    });
    return { kind: 'failed', lines, position, total };
  }

  const lines = steps.map((s) => lineFor(s, s.key === currentKey, starting));
  return { kind: 'working', lines, position, total, starting };
}
