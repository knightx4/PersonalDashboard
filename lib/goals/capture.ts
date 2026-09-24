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
 * Five moves, and only five. Close a step, count one towards a rhythm, note
 * progress against a goal, add a step, record a reading of a goal's number
 * (plan #930). Anything needing research is added as
 * a `claude` step for the next scheduled run; capture never starts a run.
 */
import type { RhythmRecord } from '@/lib/goals/rhythms';
import { formatReading, parseNumber } from '@/lib/goals/readings';
import { progressLine } from '@/lib/goals/rhythms';
import { STEP_TITLE_MAX, type RhythmPeriod, type StepNode } from '@/lib/goals/steps';
import type { Goal } from '@/lib/goals/tree';

/** The longest sentence the box takes; goals.captures refuses more. */
export const CAPTURE_BODY_MAX = 4000;
/** The most moves one sentence is filed as. More is the model misreading it. */
export const MAX_FILED = 8;
/** The longest progress note kept from one sentence. */
export const NOTE_MAX = 1000;
/** The most steps shown to the model, so a large tree cannot make the call slow. */
export const MAX_CONTEXT_STEPS = 300;

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
): CaptureContext {
  const out: CaptureContext = { goals: [], steps: [] };
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
          });
        }
        walk(node.children, depth + 1);
      }
    };
    walk(byGoal.get(goal.id) ?? [], 1);
  }
  return out;
}

/** The goals and steps written out, then the sentence. */
export function captureMessage(context: CaptureContext, body: string, today: string): string {
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
    }
  }
  lines.push('', 'What happened, as the person wrote it:', body);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// What the model returns, checked against what it was shown
// ---------------------------------------------------------------------------

export type PlannedAction =
  | { kind: 'close'; step: CaptureStep }
  | { kind: 'count'; step: CaptureStep }
  | { kind: 'note'; goal: CaptureGoal; text: string }
  | { kind: 'reading'; goal: CaptureGoal; value: number }
  | {
      kind: 'add';
      goal: CaptureGoal;
      /** The step it goes under, or null for directly under the goal. */
      parent: CaptureStep | null;
      title: string;
      stepKind: 'mine' | 'claude';
    };

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/**
 * The moves the model asked for, against real rows, in the order it gave
 * them. Anything that names a ref it was not shown, closes a rhythm, counts a
 * step that is not a rhythm with an open period, records a reading against a
 * goal with no unit or without a number, or repeats a move already listed is
 * dropped rather than guessed at. At most MAX_FILED.
 */
export function parseFiling(raw: unknown, context: CaptureContext): PlannedAction[] {
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
        planned = { kind: 'count', step };
        key = `count:${step.id}`;
        break;
      }
      case 'note': {
        const goal = goals.get(text(entry.goal));
        const note = text(entry.text).slice(0, NOTE_MAX);
        if (!goal || !note) break;
        planned = { kind: 'note', goal, text: note };
        key = `note:${goal.id}`;
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
        planned = {
          kind: 'add',
          goal,
          parent: parentStep,
          title,
          stepKind: entry.kind === 'claude' ? 'claude' : 'mine',
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
export type FiledEntry =
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
      undone_at: string | null;
    }
  | {
      kind: 'note';
      goal_id: string;
      goal_title: string;
      text: string;
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
      undone_at: string | null;
    };

/** The line shown for an entry in the filed list. */
export function describeFiled(entry: FiledEntry): string {
  switch (entry.kind) {
    case 'close':
      return `Closed "${entry.title}" in ${entry.goal_title}`;
    case 'count':
      return `Counted one towards "${entry.title}" in ${entry.goal_title}`;
    case 'note':
      return `Noted against ${entry.goal_title}: ${entry.text}`;
    case 'reading':
      return `Recorded ${formatReading(entry.value, entry.unit)} for ${entry.goal_title}`;
    case 'add':
      return entry.step_kind === 'claude'
        ? `Added a step for Claude in ${entry.goal_title}: "${entry.title}"`
        : `Added a step in ${entry.goal_title}: "${entry.title}"`;
  }
}

/** Read a stored `filed` array back, skipping anything that is not an entry. */
export function readFiled(raw: unknown): FiledEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (entry): entry is FiledEntry =>
      !!entry &&
      typeof entry === 'object' &&
      ['close', 'count', 'note', 'reading', 'add'].includes((entry as { kind?: unknown }).kind as string),
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

  const reply = await deps.ask(captureMessage(context, trimmed, today));
  if (!reply.ok) return { ok: false, error: `${reply.error} What you wrote is kept.`, captureId };

  const filed: FiledEntry[] = [];
  for (const action of parseFiling(reply.input, context)) {
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
  | { move: 'uncount'; stepId: string; startsOn: string }
  | { move: 'archive'; stepId: string }
  /** A reading is deleted outright: it was never true, and the history keeps it. */
  | { move: 'delete-reading'; readingId: string }
  /** A note changes no row, so marking it undone is the whole of taking it back. */
  | { move: 'none' };

export function undoMove(entry: FiledEntry): UndoMove {
  switch (entry.kind) {
    case 'close':
      return { move: 'reopen', stepId: entry.step_id };
    case 'count':
      return { move: 'uncount', stepId: entry.step_id, startsOn: entry.starts_on };
    case 'add':
      return { move: 'archive', stepId: entry.step_id };
    case 'reading':
      return { move: 'delete-reading', readingId: entry.reading_id };
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
