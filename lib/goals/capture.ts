/**
 * Filing a sentence from the capture box against your goals (plan #929).
 *
 * The spec's "Capture" section: you write what happened, one model call reads
 * it against your open goals and steps, and what it decided is carried out
 * and listed back with an Undo on each line. This file holds the rules and
 * none of the I/O, so the whole of filing can be tested with the model and
 * the database stubbed:
 *
 * - `captureContext` picks what the model is shown: open goals, and the open
 *   steps under them that a sentence can close, count or add beneath.
 * - `captureMessage` writes that out with short refs (g1, s4) in place of
 *   ids, so the model never has to copy a uuid.
 * - `parseFiling` turns what the model returned into actions against real
 *   rows, dropping anything that names a row it was not shown or asks for a
 *   move capture does not make.
 * - `fileCapture` runs the sequence: keep the sentence, ask, carry out each
 *   action, save the list of what was done.
 * - `undoMove` and `markUndone` are the Undo on one line.
 *
 * Five moves, and only five. Close a step, count towards a rhythm, log
 * progress on a step or goal (plan #1275), add a step, record a reading of a
 * goal's number (plan #930). Anything needing research is added as
 * a `claude` step for the next scheduled run; capture never starts a run.
 *
 * Part of a step's work is progress on that step, never a close: "moved two
 * of the bags" is 2 bags logged on the bags step, and the step stays open.
 * Work the tree has no step for is an add that carries the progress (plan
 * #1278): the step goes in already under way, and one Undo takes back both.
 */
import type { RhythmRecord } from '@/lib/goals/rhythms';
import {
  PROGRESS_UNIT_MAX,
  amountWords,
  leftWords,
  sameTotalUnit,
  tallyWords,
  towardsTotal,
  type ItemProgress,
  type ProgressEstimate,
  type ProgressTally,
} from '@/lib/goals/progress';
import { formatReading, parseNumber } from '@/lib/goals/readings';
import { periodOf, progressLine } from '@/lib/goals/rhythms';
import { STEP_TITLE_MAX, type RhythmPeriod, type StepNode } from '@/lib/goals/steps';
import type { Goal } from '@/lib/goals/tree';

/** The longest sentence the box takes; goals.captures refuses more. */
export const CAPTURE_BODY_MAX = 4000;
/** The most moves one sentence is filed as. More is the model misreading it. */
export const MAX_FILED = 8;
/** The longest progress text kept from one sentence. */
export const NOTE_MAX = 1000;
/** The most one count move adds to a rhythm, the most a period's target can be. */
export const COUNT_MAX = 100;
/** How far back a progress entry's or a count's day may go; an older day is read as a misreading. */
export const PROGRESS_DAY_MAX_AGE = 60;
/** The most steps shown to the model, so a large tree cannot make the call slow. */
export const MAX_CONTEXT_STEPS = 300;
/** How much of a done-when, and of what Dash prepared, the model is shown per step. */
export const CONTEXT_TEXT_MAX = 300;

// ---------------------------------------------------------------------------
// What the model is shown
// ---------------------------------------------------------------------------

export type CaptureGoal = {
  ref: string;
  id: string;
  title: string;
  areaName: string;
  /** What the goal is measured in; a reading can only be recorded when it has one. */
  unit: string | null;
  target: number | null;
};

export type CaptureStep = {
  ref: string;
  id: string;
  goalRef: string;
  /** The goal the step sits under, for the line shown after filing. */
  goalTitle: string;
  title: string;
  kind: 'mine' | 'claude' | 'rhythm';
  depth: number;
  /** A rhythm's shape and its current period, when it has one open. */
  rhythm: { period: RhythmPeriod; startsOn: string; count: number; target: number } | null;
  /** The done-when, shown so filing can read a total from it (plan #1277). */
  acceptance?: string | null;
  /** The step's estimated total, when it has one. */
  total?: { quantity: number; unit: string } | null;
  /** The running tallies of its progress so far, one per unit. */
  tallies?: ProgressTally[];
  /** How many progress entries it has so far (plan #1280), undone ones left out. */
  logged?: number;
  /**
   * The start of what Dash prepared for it, when it has no total yet: a
   * result such as "about 100 bags" is where a total can come from.
   */
  prepared?: string | null;
};

export type CaptureContext = { goals: CaptureGoal[]; steps: CaptureStep[] };

/**
 * Open goals in page order and the open steps beneath them, walked the way
 * the daily view walks: only through open steps, so a closed step's branch is
 * not offered. Decision steps are left out (answering one is yours, on the
 * tree) but their open children are not. A rhythm with no open period cannot
 * be counted, so it is shown without one and `parseFiling` refuses a count.
 */
export function captureContext(
  goals: { goal: Goal; areaName: string }[],
  byGoal: Map<string, StepNode[]>,
  records: Map<string, RhythmRecord>,
  progress: Readonly<Record<string, ItemProgress>> = {},
): CaptureContext {
  const out: CaptureContext = { goals: [], steps: [] };
  // What Dash prepared for each step, by the id of the step it serves.
  const preparedFor = new Map<string, string>();
  const collect = (nodes: StepNode[]) => {
    for (const node of nodes) {
      if (node.preparesId && node.result?.trim()) {
        preparedFor.set(node.preparesId, node.result.trim().slice(0, CONTEXT_TEXT_MAX));
      }
      collect(node.children);
    }
  };
  for (const nodes of byGoal.values()) collect(nodes);

  for (const { goal, areaName } of goals) {
    if (goal.status !== 'open') continue;
    const goalRef = `g${out.goals.length + 1}`;
    out.goals.push({
      ref: goalRef,
      id: goal.id,
      title: goal.title,
      areaName,
      unit: goal.unit,
      target: goal.target,
    });

    const walk = (nodes: StepNode[], depth: number) => {
      for (const node of nodes) {
        if (node.status !== 'open') continue;
        if (out.steps.length >= MAX_CONTEXT_STEPS) return;
        if (node.kind !== 'decision') {
          const current = records.get(node.id)?.current ?? null;
          out.steps.push({
            ref: `s${out.steps.length + 1}`,
            id: node.id,
            goalRef,
            goalTitle: goal.title,
            title: node.title,
            kind: node.kind,
            depth,
            rhythm:
              node.kind === 'rhythm' && node.rhythmPeriod && current
                ? {
                    period: node.rhythmPeriod,
                    startsOn: current.startsOn,
                    count: current.count,
                    target: current.target,
                  }
                : null,
            acceptance: node.acceptance?.trim().slice(0, CONTEXT_TEXT_MAX) || null,
            total:
              node.estimatedTotal && node.totalUnit
                ? { quantity: node.estimatedTotal, unit: node.totalUnit }
                : null,
            tallies: progress[node.id]?.tallies ?? [],
            logged: progress[node.id]?.entries.length ?? 0,
            prepared: node.estimatedTotal ? null : (preparedFor.get(node.id) ?? null),
          });
        }
        walk(node.children, depth + 1);
      }
    };
    walk(byGoal.get(goal.id) ?? [], 1);
  }
  return out;
}

/**
 * What filing is told about a step besides its title (plan #1277): its
 * done-when, its estimated total and how much is logged so far, and the
 * start of what Dash prepared for it when it has no total. Empty when there
 * is none of these, so a bare step is shown as its title alone.
 */
export function stepFacts(step: CaptureStep): string {
  const parts: string[] = [];
  if (step.acceptance) parts.push(`done when: ${step.acceptance}`);
  const towards = step.total
    ? towardsTotal(step.total.quantity, step.total.unit, step.tallies ?? [])
    : null;
  if (towards) {
    parts.push(
      `total about ${amountWords(towards.total, towards.unit)}, ` +
        `${amountWords(towards.done, towards.unit)} so far`,
    );
  } else {
    const tally = tallyWords(step.tallies ?? []);
    if (tally) parts.push(tally);
  }
  if (step.prepared) parts.push(`Dash prepared: ${step.prepared.replace(/\s+/g, ' ')}`);
  // "no total" only beside something a total could be read from or counted
  // against; a bare step gets no line at all.
  if (!towards && parts.length > 0) parts.splice(step.acceptance ? 1 : 0, 0, 'no total');
  return step.kind === 'rhythm' ? '' : parts.join('; ');
}

/**
 * The goals and steps written out, then the sentence. `hint` is the move the
 * capture box already settled on (lib/goals/capture-sort.ts), when it did.
 */
export function captureMessage(
  context: CaptureContext,
  body: string,
  today: string,
  hint?: string | null,
): string {
  const lines: string[] = [`Today is ${today}.`, '', 'Open goals and their open steps:'];
  if (context.goals.length === 0) lines.push('(none)');
  for (const goal of context.goals) {
    const measured = goal.unit
      ? `; measured in ${goal.unit}` +
        (goal.target !== null ? `, target ${formatReading(goal.target, goal.unit)}` : '')
      : '';
    lines.push(`${goal.ref}: ${goal.title} (area: ${goal.areaName}${measured})`);
    for (const step of context.steps.filter((s) => s.goalRef === goal.ref)) {
      const indent = '  '.repeat(step.depth);
      const shape =
        step.kind === 'rhythm'
          ? step.rhythm
            ? `rhythm, ${progressLine(step.rhythm.period, step.rhythm)}`
            : 'rhythm, no period open'
          : step.kind;
      lines.push(`${indent}${step.ref} [${shape}]: ${step.title}`);
      const about = stepFacts(step);
      if (about) lines.push(`${indent}  (${about})`);
    }
  }
  if (hint) lines.push('', hint);
  lines.push('', 'What happened, as the person wrote it:', body);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// What the model returns, checked against what it was shown
// ---------------------------------------------------------------------------

export type PlannedAction =
  | { kind: 'close'; step: CaptureStep }
  | {
      kind: 'count';
      step: CaptureStep;
      /** How many occurrences the sentence reported (plan #1279); one when it gave no number. */
      amount: number;
      /** YYYY-MM-DD, or null for the day it was filed. */
      happenedOn: string | null;
      /** The start of the period that day falls in, which the count goes towards. */
      startsOn: string;
    }
  | {
      kind: 'progress';
      /** The goal the entry counts under: the step's goal, or the goal itself. */
      goal: CaptureGoal;
      /** The step it sits on, or null when it sits on the goal. */
      step: CaptureStep | null;
      text: string;
      quantity: number | null;
      unit: string | null;
      /** YYYY-MM-DD, or null for the day it was filed. */
      happenedOn: string | null;
      /**
       * A total to set on a step that has none, read from its done-when or
       * what Dash prepared (plan #1277), in the entry's unit. Null otherwise.
       */
      setTotal?: number | null;
    }
  | { kind: 'reading'; goal: CaptureGoal; value: number }
  | {
      kind: 'add';
      goal: CaptureGoal;
      /** The step it goes under, or null for directly under the goal. */
      parent: CaptureStep | null;
      title: string;
      stepKind: 'mine' | 'claude';
      /**
       * Work already done on the new step, logged on it as it is added (plan
       * #1278). Null for a step nothing has been done on yet.
       */
      progress?: AddedProgress | null;
    };

/** The progress an add carries, in the progress move's terms. */
export type AddedProgress = {
  text: string;
  quantity: number | null;
  unit: string | null;
  /** YYYY-MM-DD, or null for the day it was filed. */
  happenedOn: string | null;
  /** How many in all, when the sentence said; null otherwise. */
  setTotal: number | null;
};

type ProgressAction = Extract<PlannedAction, { kind: 'progress' }>;
type AddAction = Extract<PlannedAction, { kind: 'add' }>;

/**
 * The progress an add carries, as a progress move on the step it wrote, so
 * the store and `progressTotal` treat it as any other entry. Null when the
 * add carries none.
 */
export function addedProgress(action: AddAction, stepId: string): ProgressAction | null {
  if (!action.progress) return null;
  const step: CaptureStep = {
    ref: '',
    id: stepId,
    goalRef: action.goal.ref,
    goalTitle: action.goal.title,
    title: action.title,
    kind: action.stepKind,
    depth: action.parent ? action.parent.depth + 1 : 1,
    rhythm: null,
    total: null,
    tallies: [],
    logged: 0,
  };
  return { kind: 'progress', goal: action.goal, step, ...action.progress };
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const DAY_MS = 86_400_000;

/**
 * The amount a move gave: a number more than nothing, and a unit only with a
 * number. Null when it breaks either rule.
 */
function readAmount(
  entry: Record<string, unknown>,
): { quantity: number | null; unit: string | null } | null {
  const hasQuantity = entry.quantity !== null && entry.quantity !== undefined && entry.quantity !== '';
  const quantity = hasQuantity ? parseNumber(entry.quantity) : null;
  if (hasQuantity && (quantity === null || quantity <= 0)) return null;
  const unit = text(entry.unit) || null;
  if (unit && (quantity === null || unit.length > PROGRESS_UNIT_MAX)) return null;
  return { quantity, unit };
}

/**
 * How many a count move reported: one when it gave no number, a whole number
 * from 1 to COUNT_MAX when it did, and null for anything else.
 */
function readCount(entry: Record<string, unknown>): number | null {
  const raw = entry.quantity;
  if (raw === null || raw === undefined || raw === '') return 1;
  const count = parseNumber(raw);
  if (count === null || !Number.isInteger(count) || count < 1 || count > COUNT_MAX) return null;
  return count;
}

/** A total the move gave, when it is a number more than nothing. */
function readTotal(entry: Record<string, unknown>): number | null {
  const raw =
    entry.total === null || entry.total === undefined || entry.total === ''
      ? null
      : parseNumber(entry.total);
  return raw !== null && raw > 0 ? raw : null;
}

/**
 * The day the model gave for a progress entry, when it is a real date no
 * later than today and no more than PROGRESS_DAY_MAX_AGE days back. Anything
 * else is null, which files it on today.
 */
export function progressDay(raw: unknown, today: string | null | undefined): string | null {
  const day = text(raw);
  if (!today || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const at = Date.parse(`${day}T00:00:00Z`);
  const now = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(at) || !Number.isFinite(now)) return null;
  // Date.parse rolls 2026-02-30 over to March; only a date that reads back the same is one.
  if (new Date(at).toISOString().slice(0, 10) !== day) return null;
  if (at > now || now - at > PROGRESS_DAY_MAX_AGE * DAY_MS) return null;
  return day;
}

/** What a progress line records about the step's total (plan #1277). */
export type ProgressTotal = {
  total: number;
  total_unit: string;
  done: number;
  total_set: boolean;
};

/**
 * The step's total, set now or already there, and how much counts towards it
 * with this entry in. Null when the step has none, or when the entry is in
 * another unit than the total, since then it says nothing about what is left.
 */
export function progressTotal(
  action: ProgressAction,
): ProgressTotal | null {
  const step = action.step;
  if (!step || action.quantity === null) return null;
  const setTotal = !step.total && action.setTotal && action.unit ? action.setTotal : null;
  const total = step.total ?? (setTotal ? { quantity: setTotal, unit: action.unit as string } : null);
  if (!total || !sameTotalUnit(action.unit, total.unit)) return null;
  const towards = towardsTotal(total.quantity, total.unit, [
    ...(step.tallies ?? []),
    { quantity: action.quantity, unit: action.unit },
  ]);
  if (!towards) return null;
  return {
    total: towards.total,
    total_unit: towards.unit,
    done: towards.done,
    total_set: setTotal !== null,
  };
}

/**
 * Whether the filed line should ask once how far along the step is (plan
 * #1280): the entry is the first on a step, and the step has no total and
 * this line set none. Asked only then, so once the first entry is filed the
 * question does not come back for that step, answered or not.
 */
export function asksEstimate(action: ProgressAction, total: ProgressTotal | null): boolean {
  const step = action.step;
  if (!step || step.total || total) return false;
  return (step.logged ?? 0) === 0;
}

/**
 * The moves the model asked for, against real rows, in the order it gave
 * them. Anything that names a ref it was not shown, closes a rhythm, counts a
 * step that is not a rhythm with an open period, records a reading against a
 * goal with no unit or without a number, or repeats a move already listed is
 * dropped rather than guessed at. At most MAX_FILED.
 *
 * Progress names a step, or a goal when no step fits. It needs its text; an
 * amount has to be more than nothing, and a unit needs an amount. A move
 * breaking either is dropped. A day outside the last PROGRESS_DAY_MAX_AGE
 * days (or with no `today` to check it against) is dropped on its own, and
 * the entry is filed on today. The goal-only `note` of earlier versions is
 * read as progress on that goal.
 *
 * A count is one unless it gives a whole number up to COUNT_MAX; any other
 * number drops it. Its day is read as progress's is, and picks the period
 * the count goes towards (plan #1279).
 */
export function parseFiling(
  raw: unknown,
  context: CaptureContext,
  today?: string | null,
): PlannedAction[] {
  const list =
    raw && typeof raw === 'object' && Array.isArray((raw as { actions?: unknown }).actions)
      ? ((raw as { actions: unknown[] }).actions)
      : [];
  const goals = new Map(context.goals.map((g) => [g.ref, g]));
  const steps = new Map(context.steps.map((s) => [s.ref, s]));
  const seen = new Set<string>();
  const out: PlannedAction[] = [];

  for (const item of list) {
    if (out.length >= MAX_FILED) break;
    if (!item || typeof item !== 'object') continue;
    const entry = item as Record<string, unknown>;
    let planned: PlannedAction | null = null;
    let key = '';

    switch (entry.type) {
      case 'close': {
        const step = steps.get(text(entry.step));
        if (!step || step.kind === 'rhythm') break;
        planned = { kind: 'close', step };
        key = `close:${step.id}`;
        break;
      }
      case 'count': {
        const step = steps.get(text(entry.step));
        if (!step || step.kind !== 'rhythm' || !step.rhythm) break;
        const amount = readCount(entry);
        if (amount === null) break;
        // Counted in the period the day falls in (plan #1279): "yesterday"
        // can be last week's when today is a Monday.
        const happenedOn = progressDay(entry.day, today);
        const startsOn = happenedOn
          ? periodOf(step.rhythm.period, happenedOn).startsOn
          : step.rhythm.startsOn;
        planned = { kind: 'count', step, amount, happenedOn, startsOn };
        key = `count:${step.id}:${startsOn}`;
        break;
      }
      case 'progress':
      case 'note': {
        // A step when it names one; otherwise the goal. A named step that was
        // not shown is a bad ref, not a reason to fall back on the goal.
        const stepRef = entry.type === 'progress' ? text(entry.step) : '';
        const step = stepRef ? steps.get(stepRef) : null;
        if (stepRef && (!step || step.kind === 'rhythm')) break;
        const goal = step
          ? context.goals.find((g) => g.ref === step.goalRef)
          : goals.get(text(entry.goal));
        const said = text(entry.text).slice(0, NOTE_MAX);
        if (!goal || !said) break;

        const amount = readAmount(entry);
        if (!amount) break;
        const { quantity, unit } = amount;

        // A total only for a step that has none, counted in the entry's own
        // unit; anything else is dropped and the entry filed without it.
        const rawTotal = readTotal(entry);
        const setTotal = step && !step.total && unit && rawTotal !== null ? rawTotal : null;

        planned = {
          kind: 'progress',
          goal,
          step: step ?? null,
          text: said,
          quantity,
          unit,
          happenedOn: progressDay(entry.day, today),
          setTotal,
        };
        key = `progress:${(step ?? goal).id}`;
        break;
      }
      case 'reading': {
        const goal = goals.get(text(entry.goal));
        const value = parseNumber(entry.value);
        if (!goal || !goal.unit || value === null) break;
        planned = { kind: 'reading', goal, value };
        key = `reading:${goal.id}`;
        break;
      }
      case 'add': {
        const ref = text(entry.parent);
        const title = text(entry.title).slice(0, STEP_TITLE_MAX);
        if (!title) break;
        const parentStep = steps.get(ref) ?? null;
        // A step goes under a goal or under an ordinary step; a rhythm is a
        // count, not something to break down.
        if (parentStep && parentStep.kind === 'rhythm') break;
        const goal = parentStep
          ? context.goals.find((g) => g.ref === parentStep.goalRef)
          : goals.get(ref);
        if (!goal) break;
        // Work already done on the new step (plan #1278): text or an amount
        // makes it progress. A bad amount drops the progress, not the step.
        const said = text(entry.text).slice(0, NOTE_MAX);
        const amount = readAmount(entry);
        const carries = !!said || (amount?.quantity ?? null) !== null;
        const progress: AddedProgress | null =
          carries && amount
            ? {
                text: said || title,
                quantity: amount.quantity,
                unit: amount.unit,
                happenedOn: progressDay(entry.day, today),
                setTotal: amount.unit ? readTotal(entry) : null,
              }
            : null;
        planned = {
          kind: 'add',
          goal,
          parent: parentStep,
          title,
          stepKind: entry.kind === 'claude' ? 'claude' : 'mine',
          progress,
        };
        key = `add:${(parentStep ?? goal).id}:${title.toLowerCase()}`;
        break;
      }
    }

    if (!planned || seen.has(key)) continue;
    seen.add(key);
    out.push(planned);
  }
  return out;
}

// ---------------------------------------------------------------------------
// What was filed, as kept in goals.captures.filed
// ---------------------------------------------------------------------------

/**
 * One line of what a capture did, as stored in the `filed` array. Snake case,
 * because routines read it with SQL. `undone_at` is set by Undo and the entry
 * is never removed, so the capture keeps the whole story.
 */
export type FiledEntry = (
  | {
      kind: 'close';
      step_id: string;
      title: string;
      goal_title: string;
      undone_at: string | null;
    }
  | {
      kind: 'count';
      step_id: string;
      title: string;
      goal_title: string;
      /** The period counted towards, so Undo takes it back from the same one. */
      starts_on: string;
      /**
       * How many were counted (plan #1279), so Undo takes back the same
       * number. Absent on lines filed before, which counted one.
       */
      amount?: number;
      /** YYYY-MM-DD: the day the count was filed on. Absent on lines filed before. */
      counted_on?: string;
      undone_at: string | null;
    }
  | {
      /**
       * Written before plan #1275 and no longer produced: a note kept on the
       * capture alone. Still read, so an old list shows and undoes.
       */
      kind: 'note';
      goal_id: string;
      goal_title: string;
      text: string;
      undone_at: string | null;
    }
  | {
      kind: 'progress';
      /** The goals.progress_entries row the capture wrote, so Undo can take it back. */
      entry_id: string;
      /** The step or goal the entry sits on. */
      item_id: string;
      /** The step's title, or null when the entry sits on the goal. */
      step_title: string | null;
      goal_title: string;
      text: string;
      quantity: number | null;
      unit: string | null;
      /** YYYY-MM-DD. */
      happened_on: string;
      /**
       * The step's estimated total and how much was logged towards it once
       * this entry was in (plan #1277). Absent when the step has none, and on
       * lines filed before.
       */
      total?: number | null;
      total_unit?: string | null;
      done?: number | null;
      /** Whether this line set the total, so Undo clears it again. */
      total_set?: boolean;
      /** Whether the line asks how far along the step is (plan #1280). */
      ask_estimate?: boolean;
      /** The answer tapped, kept on the entry too. */
      estimate?: ProgressEstimate | null;
      undone_at: string | null;
    }
  | {
      kind: 'reading';
      /** The reading the capture wrote, so Undo can delete it. */
      reading_id: string;
      goal_id: string;
      goal_title: string;
      value: number;
      unit: string | null;
      undone_at: string | null;
    }
  | {
      kind: 'add';
      /** The step the capture wrote. */
      step_id: string;
      title: string;
      step_kind: 'mine' | 'claude';
      goal_title: string;
      /**
       * The progress entry written on the new step with it (plan #1278), so
       * Undo on this one line takes back both. Absent when there was none.
       */
      progress?: AddedFiledProgress;
      undone_at: string | null;
    }
) & {
  /**
   * The core.dash_actions row that records this line (plan #1569), so
   * capture's Undo marks it undone and Home's Undo finds the line. Absent on
   * lines filed before, and when the record could not be written.
   */
  action_id?: string;
};

/** The progress an added step was filed with, as kept on its line. */
export type AddedFiledProgress = {
  entry_id: string;
  text: string;
  quantity: number | null;
  unit: string | null;
  /** YYYY-MM-DD. */
  happened_on: string;
  total?: number | null;
  total_unit?: string | null;
  done?: number | null;
  total_set?: boolean;
  ask_estimate?: boolean;
  estimate?: ProgressEstimate | null;
};

/** What a line says about an amount towards a total, when it has both. */
function leftOf(entry: {
  total?: number | null;
  total_unit?: string | null;
  done?: number | null;
}): string | null {
  const towards =
    entry.total && entry.done !== null && entry.done !== undefined
      ? towardsTotal(entry.total, entry.total_unit, [
          { quantity: entry.done, unit: entry.total_unit ?? null },
        ])
      : null;
  return towards ? leftWords(towards) : null;
}

/** The line shown for an entry in the filed list. */
export function describeFiled(entry: FiledEntry): string {
  switch (entry.kind) {
    case 'close':
      return `Closed "${entry.title}" in ${entry.goal_title}`;
    case 'count': {
      const amount = entry.amount ?? 1;
      return `Counted ${amount === 1 ? 'one' : amount} towards "${entry.title}" in ${entry.goal_title}`;
    }
    case 'note':
      return `Noted against ${entry.goal_title}: ${entry.text}`;
    case 'progress': {
      const on = entry.step_title
        ? `"${entry.step_title}" in ${entry.goal_title}`
        : entry.goal_title;
      if (entry.quantity === null) return `Logged progress on ${on}: ${entry.text}`;
      const logged = `Logged ${formatReading(entry.quantity, entry.unit)} on ${on}`;
      const left = leftOf(entry);
      return left ? `${logged}, ${left}` : logged;
    }
    case 'reading':
      return `Recorded ${formatReading(entry.value, entry.unit)} for ${entry.goal_title}`;
    case 'add': {
      const added =
        entry.step_kind === 'claude'
          ? `Added a step for Dash in ${entry.goal_title}: "${entry.title}"`
          : `Added a step in ${entry.goal_title}: "${entry.title}"`;
      const progress = entry.progress;
      if (!progress) return added;
      if (progress.quantity === null) return `${added}, under way: ${progress.text}`;
      const logged = `${added}, ${formatReading(progress.quantity, progress.unit)} logged`;
      const left = leftOf(progress);
      return left ? `${logged}, ${left}` : logged;
    }
  }
}

/**
 * The sentence Home shows for a line in what Dash did today (plan #1569):
 * the line's own words, said as Dash's, from the capture.
 */
export function captureSummary(entry: FiledEntry): string {
  const line =
    entry.kind === 'add' && entry.step_kind === 'claude'
      ? describeFiled(entry).replace('a step for Dash', 'a step for itself')
      : describeFiled(entry);
  const said = `From your capture, Dash ${line.charAt(0).toLowerCase()}${line.slice(1)}`;
  return /[.!?…]$/.test(said) ? said : `${said}.`;
}

/**
 * The progress entry a line is asking about (plan #1280): the line asks, has
 * not been answered and has not been undone. Null otherwise, and on every
 * line filed before.
 */
export function estimateAsked(entry: FiledEntry): string | null {
  if (entry.undone_at) return null;
  const progress =
    entry.kind === 'progress' ? entry : entry.kind === 'add' ? (entry.progress ?? null) : null;
  if (!progress?.ask_estimate || progress.estimate) return null;
  return progress.entry_id;
}

/**
 * The list with one line's answer kept on it, or null when that line is not
 * asking. The rows are written by the store; this is what the capture keeps.
 */
export function withEstimate(
  filed: FiledEntry[],
  index: number,
  estimate: ProgressEstimate,
): FiledEntry[] | null {
  const entry = filed[index];
  if (!entry || !estimateAsked(entry)) return null;
  return filed.map((e, i) => {
    if (i !== index) return e;
    if (e.kind === 'progress') return { ...e, estimate };
    if (e.kind === 'add' && e.progress) return { ...e, progress: { ...e.progress, estimate } };
    return e;
  });
}

/** Read a stored `filed` array back, skipping anything that is not an entry. */
export function readFiled(raw: unknown): FiledEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (entry): entry is FiledEntry =>
      !!entry &&
      typeof entry === 'object' &&
      ['close', 'count', 'note', 'progress', 'reading', 'add'].includes((entry as { kind?: unknown }).kind as string),
  );
}

// ---------------------------------------------------------------------------
// The sequence
// ---------------------------------------------------------------------------

/** What the model call came back with: its tool input, or why there is none. */
export type AskResult = { ok: true; input: unknown } | { ok: false; error: string };

export type FilingDeps = {
  /** Store the sentence as typed; returns the capture's id. */
  keep: (body: string) => Promise<string>;
  /** What the model is shown. */
  context: () => Promise<CaptureContext>;
  /** The model call. */
  ask: (message: string) => Promise<AskResult>;
  /** Carry out one move; null when it no longer applies (the step closed meanwhile). */
  apply: (captureId: string, action: PlannedAction) => Promise<FiledEntry | null>;
  /** Write the list of what was done onto the capture. */
  save: (captureId: string, filed: FiledEntry[]) => Promise<void>;
};

export type FilingResult =
  | { ok: true; captureId: string; filed: FiledEntry[] }
  | { ok: false; error: string; captureId: string | null };

/**
 * Keep the sentence, ask, carry out, save.
 *
 * The sentence is kept before the model is asked, so a failed call still
 * leaves what you wrote in goals.captures. Moves are carried out one at a
 * time in the order given: an add under a step and a close of that step in
 * one sentence then land in the order the model meant. A move that fails is
 * left off the list rather than stopping the others, since each line has its
 * own Undo and a partial filing is still accurate about what it did.
 */
export async function fileCapture(
  body: string,
  today: string,
  deps: FilingDeps,
  hint?: string | null,
): Promise<FilingResult> {
  const trimmed = body.trim();
  if (!trimmed) return { ok: false, error: 'Write what happened first.', captureId: null };
  if (body.length > CAPTURE_BODY_MAX) {
    return {
      ok: false,
      error: `That is longer than ${CAPTURE_BODY_MAX} characters. Shorten it and file again.`,
      captureId: null,
    };
  }

  const [captureId, context] = await Promise.all([deps.keep(body), deps.context()]);

  const reply = await deps.ask(captureMessage(context, trimmed, today, hint));
  if (!reply.ok) return { ok: false, error: `${reply.error} What you wrote is kept.`, captureId };

  const filed: FiledEntry[] = [];
  for (const action of parseFiling(reply.input, context, today)) {
    try {
      const entry = await deps.apply(captureId, action);
      if (entry) filed.push(entry);
    } catch {
      /* left off the list: it did not happen */
    }
  }

  if (filed.length > 0) await deps.save(captureId, filed);
  return { ok: true, captureId, filed };
}

/** What Undo has to do to the goals for one entry. */
export type UndoMove =
  | { move: 'reopen'; stepId: string }
  | { move: 'uncount'; stepId: string; startsOn: string; amount: number }
  | {
      move: 'archive';
      stepId: string;
      /** The progress entry filed on the new step with it, taken back too (plan #1278). */
      progress?: { entryId: string; clearTotal?: { stepId: string; total: number } };
    }
  /** A reading is deleted outright: it was never true, and the history keeps it. */
  | { move: 'delete-reading'; readingId: string }
  /** A progress entry is marked undone, as everywhere else it is taken back. */
  | {
      move: 'undo-progress';
      entryId: string;
      /** The step whose total this line set, so Undo clears it; absent otherwise. */
      clearTotal?: { stepId: string; total: number };
    }
  /** A note changes no row, so marking it undone is the whole of taking it back. */
  | { move: 'none' };

export function undoMove(entry: FiledEntry): UndoMove {
  switch (entry.kind) {
    case 'close':
      return { move: 'reopen', stepId: entry.step_id };
    case 'count':
      return {
        move: 'uncount',
        stepId: entry.step_id,
        startsOn: entry.starts_on,
        amount: entry.amount ?? 1,
      };
    case 'add': {
      const progress = entry.progress;
      if (!progress) return { move: 'archive', stepId: entry.step_id };
      return {
        move: 'archive',
        stepId: entry.step_id,
        progress:
          progress.total_set && progress.total
            ? {
                entryId: progress.entry_id,
                clearTotal: { stepId: entry.step_id, total: progress.total },
              }
            : { entryId: progress.entry_id },
      };
    }
    case 'reading':
      return { move: 'delete-reading', readingId: entry.reading_id };
    case 'progress':
      return entry.total_set && entry.total
        ? {
            move: 'undo-progress',
            entryId: entry.entry_id,
            clearTotal: { stepId: entry.item_id, total: entry.total },
          }
        : { move: 'undo-progress', entryId: entry.entry_id };
    case 'note':
      return { move: 'none' };
  }
}

/** The list with one entry marked undone, or null when it is gone or already undone. */
export function markUndone(filed: FiledEntry[], index: number, at: string): FiledEntry[] | null {
  const entry = filed[index];
  if (!entry || entry.undone_at) return null;
  return filed.map((e, i) => (i === index ? { ...e, undone_at: at } : e));
}
