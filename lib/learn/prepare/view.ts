import { sourceDocuments, type FinishDetail, type SourceDocument } from './finish-step';
import type { PreparationRow, PreparationStepRow } from './run';
import type { PulledDocument } from './structure-steps';
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
 * What a finished run found, one count from the step that owns it (plan
 * #2276.6). Summing every step's counts counted documents three times (the
 * pull, the match and the territory each record one) and added the pull's
 * stored weeks to the units written, so each count is read from its own step:
 * documents stored by the pull, weeks matched, topics drafted, units written.
 * A zero is left out; the Sources list says when nothing was stored.
 */
const FINISHED_COUNTS: [step: PreparationStepKey, from: string, as: string][] = [
  ['pull_documents', 'documents', 'documents'],
  ['match_weeks', 'weeks', 'weeks'],
  ['draft_topics', 'drafted', 'topics'],
  ['write_units', 'units', 'units'],
];

function finishedCounts(steps: readonly PreparationStepRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, from, as] of FINISHED_COUNTS) {
    const counts = steps.find((s) => s.key === key)?.counts ?? {};
    // A run from before draft_topics recorded `drafted` kept the drafted count under `topics`.
    const n = counts[from] ?? (key === 'draft_topics' ? counts.topics : undefined);
    if (typeof n === 'number' && Number.isFinite(n) && n > 0) out[as] = n;
  }
  return out;
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
    const found = countsLine(finishedCounts(steps));
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

/** A branch run as the page draws it (plan #2276.7): its name and its lines. */
/**
 * The run in one line, for a place that links to the subject rather than
 * showing the run: a learning goal's page (plan #2302.2). "Prepared in 6
 * minutes · 31 topics drafted", "Preparing · step 4 of 8, Lay out the
 * territory", "Preparation stopped · step 2 of 8, Find syllabi and other
 * structure documents", or "Not prepared yet".
 */
export function preparationLine(view: PreparationView): string {
  if (view.kind === 'none') return 'Not prepared yet';
  if (view.kind === 'finished') return view.summary;
  const at = view.lines.find((line) => line.state === (view.kind === 'failed' ? 'failed' : 'current'));
  const where = `step ${view.position} of ${view.total}${at ? `, ${at.label}` : ''}`;
  if (view.kind === 'failed') return `Preparation stopped · ${where}`;
  return view.starting ? 'Preparing · starting in a moment' : `Preparing · ${where}`;
}

export type BranchPreparationView = { key: string; name: string; view: PreparationView };

export function branchPreparationView(prep: { run: PreparationRow; steps: PreparationStepRow[] }): BranchPreparationView | null {
  const branch = prep.run.branch;
  if (!branch) return null;
  const view = preparationView(prep);
  if (view.kind !== 'finished') return { key: branch.key, name: branch.name, view };
  // One sentence with no separator to break on: the drafted topics are what a branch run is for.
  const drafted = finishedCounts(prep.steps).topics ?? 0;
  const took = tookLine(prep.run.startedAt, prep.run.finishedAt);
  const summary =
    `Went deeper on ${branch.name}: ${plural(drafted, 'topic')} drafted` + (took ? ` in ${took}.` : '.');
  return { key: branch.key, name: branch.name, view: { kind: 'finished', summary } };
}

/**
 * Where a finished preparation says to start and what it came from (plan
 * #2276.6), read from the finish step's detail. A run that finished before
 * the finish step kept these still lists the documents the pull stored. Null
 * until the run is done.
 */
export type PreparationSources = {
  /** The finished line, as the folded block shows it. */
  summary: string;
  start: FinishDetail['start'];
  documents: SourceDocument[];
  frames: string[];
};

const isStrings = (value: unknown): value is string[] => Array.isArray(value) && value.every((v) => typeof v === 'string');

function readStart(value: unknown): FinishDetail['start'] {
  const start = (value && typeof value === 'object' ? value : {}) as { unit?: unknown; topic?: unknown };
  const topic = start.topic as { id?: unknown; name?: unknown; ask?: unknown } | null | undefined;
  return {
    unit: typeof start.unit === 'string' ? start.unit : null,
    topic:
      topic && typeof topic.id === 'string' && typeof topic.name === 'string'
        ? { id: topic.id, name: topic.name, ask: typeof topic.ask === 'string' ? topic.ask : topic.name }
        : null,
  };
}

export function preparationSources(
  prep: { run: PreparationRow; steps: PreparationStepRow[] } | null,
): PreparationSources | null {
  if (!prep || prep.run.status !== 'done') return null;
  const view = preparationView(prep);
  const summary = view.kind === 'finished' ? view.summary : 'Prepared';
  const finish = prep.steps.find((s) => s.key === 'finish')?.detail ?? {};
  const pulled = prep.steps.find((s) => s.key === 'pull_documents')?.detail?.documents;
  const documents = Array.isArray(finish.documents)
    ? (finish.documents as SourceDocument[])
    : sourceDocuments(Array.isArray(pulled) ? (pulled as PulledDocument[]) : [], null);
  return {
    summary,
    start: readStart(finish.start),
    documents: documents.filter((d) => d && typeof d.title === 'string'),
    frames: isStrings(finish.frames) ? finish.frames : [],
  };
}

/**
 * Where the opening units come from while a run is going (plan #2276.9): the
 * position of the write_units step among the run's steps and how many there
 * are, or null when the run is not working or that step has already been and
 * gone (a subject left with no units then is offered the card instead).
 */
export function unitsComeAtStep(view: PreparationView): { position: number; total: number } | null {
  if (view.kind !== 'working') return null;
  const index = view.lines.findIndex((l) => l.key === 'write_units');
  if (index < 0) return null;
  const state = view.lines[index].state;
  if (state !== 'pending' && state !== 'current') return null;
  return { position: index + 1, total: view.lines.length };
}
