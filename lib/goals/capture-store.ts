import 'server-only';

import {
  markDashActionUndone,
  readSubjectOrNull,
  recordDashAction,
  type DashActionDeps,
  type DashActionOp,
} from '@/lib/core/dash-actions';
import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import {
  MAX_CONTEXT_STEPS,
  addedProgress,
  asksEstimate,
  captureContext,
  captureSummary,
  estimateAsked,
  markUndone,
  progressTotal,
  readFiled,
  undoMove,
  withEstimate,
  type AddedFiledProgress,
  type CaptureContext,
  type FiledEntry,
  type PlannedAction,
} from '@/lib/goals/capture';
import { summariseProgress, type ProgressEstimate } from '@/lib/goals/progress';
import {
  addProgressEntry,
  clearTotalIfUnchanged,
  loadProgressEntries,
  setProgressEstimate,
  setTotalIfNone,
  undoProgressEntry,
} from '@/lib/goals/progress-store';
import { addReading, deleteReading } from '@/lib/goals/readings-store';
import { liveRhythms } from '@/lib/goals/rhythms';
import { countTowards, syncRhythms } from '@/lib/goals/rhythms-store';
import type { StepNode } from '@/lib/goals/steps';
import {
  insertStep,
  loadLiveTree,
  setStepArchived,
  setStepStatus,
  type Today,
} from '@/lib/goals/steps-store';

/**
 * Reads and writes for the capture box (plan #929). The rules are in
 * lib/goals/capture.ts; this file carries them out.
 *
 * Every write goes through a client made with the capture actor and the
 * capture's id (createGoalsClient({ actor: 'capture', captureId })), so each
 * change lands in goals.history as capture's, pointing at the sentence that
 * made it. Undo goes through the same kind of client, so the reversal is
 * tied to the same capture.
 *
 * Each line filed is also recorded in core.dash_actions with surface
 * 'capture' (plan #1569), so Home lists it among what Dash did today. The
 * line keeps the record's id in `action_id`; the record keeps the capture's
 * id in `undo`. Either Undo goes through undoFiled, which puts the line back
 * by capture's own rule and marks the record undone.
 */

/** Keep the sentence exactly as typed, under an id chosen here so the history can name it. */
export async function keepCapture(
  client: GoalsSupabaseClient,
  userId: string,
  id: string,
  body: string,
): Promise<string> {
  const { error } = await client.from('captures').insert({ id, user_id: userId, body });
  if (error) throw new Error(`Could not keep what you wrote: ${error.message}`);
  return id;
}

/**
 * What the model is shown: every live goal and step, with rhythm periods
 * brought up to today first so a rhythm has an open period to count towards.
 */
export async function loadCaptureContext(
  client: GoalsSupabaseClient,
  { userId, today }: Today,
): Promise<CaptureContext> {
  const { goals, byGoal } = await loadLiveTree(client, { today });
  const live = liveRhythms(
    goals.map((g) => g.goal),
    byGoal,
  );
  const records = await syncRhythms(client, userId, live, today);
  // Each step's tally so far, so filing can say how much is left (plan #1277).
  // Only the open steps the model is shown, walked as captureContext walks.
  const stepIds: string[] = [];
  const collect = (nodes: StepNode[]) => {
    for (const node of nodes) {
      if (node.status !== 'open' || stepIds.length >= MAX_CONTEXT_STEPS) continue;
      stepIds.push(node.id);
      collect(node.children);
    }
  };
  for (const nodes of byGoal.values()) collect(nodes);
  const progress = summariseProgress(await loadProgressEntries(client, stepIds));
  return captureContext(goals, byGoal, records, progress);
}

/** What a move did, and the row its record names. */
type CarriedOut = {
  entry: FiledEntry;
  kind: string;
  ref: string;
  op: DashActionOp;
  before?: Record<string, unknown> | null;
};

/** A rhythm's period row as it is, for the record's before values. */
async function periodRow(
  dash: DashActionDeps | null,
  client: GoalsSupabaseClient,
  itemId: string,
  startsOn: string,
): Promise<Record<string, unknown> | null> {
  if (!dash) return null;
  try {
    const { data } = await client
      .from('periods')
      .select('*')
      .eq('item_id', itemId)
      .eq('starts_on', startsOn)
      .maybeSingle();
    return (data as Record<string, unknown> | null) ?? null;
  } catch {
    return null;
  }
}

/**
 * Carry out one move, and record it as Dash's when `dash` is given. Null
 * when it no longer applies. The record is best-effort: a line whose record
 * could not be written is filed all the same, without an `action_id`.
 */
export async function applyCaptureAction(
  client: GoalsSupabaseClient,
  context: Today & { captureId: string; dash?: DashActionDeps | null },
  action: PlannedAction,
): Promise<FiledEntry | null> {
  const dash = context.dash ?? null;
  const done = await carryOut(client, context, action, dash);
  if (!done) return null;
  if (!dash) return done.entry;
  const actionId = await recordDashAction(dash, {
    surface: 'capture',
    kind: done.kind,
    subjectRef: done.ref,
    op: done.op,
    summary: captureSummary(done.entry),
    beforeValues: done.before ?? null,
    undo: { capture_id: context.captureId },
  });
  return actionId ? { ...done.entry, action_id: actionId } : done.entry;
}

async function carryOut(
  client: GoalsSupabaseClient,
  { userId, today, captureId }: Today & { captureId: string },
  action: PlannedAction,
  dash: DashActionDeps | null,
): Promise<CarriedOut | null> {
  switch (action.kind) {
    case 'close': {
      const ref = `goals.items:${action.step.id}`;
      const before = dash ? await readSubjectOrNull(dash, ref) : null;
      const changed = await setStepStatus(client, action.step.id, 'done');
      if (!changed) return null;
      return { kind: 'close_step', ref, op: 'update', before, entry: {
        kind: 'close',
        step_id: action.step.id,
        title: action.step.title,
        goal_title: action.step.goalTitle,
        undone_at: null,
      } };
    }
    case 'count': {
      const rhythm = action.step.rhythm;
      if (!rhythm) return null;
      // Towards the period the day falls in, closed or not (plan #1279). A
      // day before the rhythm's first period has no row to count in, so it
      // goes towards the current one rather than being lost.
      let startsOn = action.startsOn;
      let before = await periodRow(dash, client, action.step.id, startsOn);
      let counted = await countTowards(client, action.step.id, startsOn, action.amount, {
        closed: true,
      });
      if (!counted && startsOn !== rhythm.startsOn) {
        startsOn = rhythm.startsOn;
        before = await periodRow(dash, client, action.step.id, startsOn);
        counted = await countTowards(client, action.step.id, startsOn, action.amount);
      }
      if (!counted) return null;
      // Without the period's id there is no row to name, so the record goes
      // on the step: Undo still goes by the line, which keeps the period.
      const ref = before?.id ? `goals.periods:${before.id as string}` : `goals.items:${action.step.id}`;
      return { kind: 'count_towards', ref, op: 'update', before: before?.id ? before : null, entry: {
        kind: 'count',
        step_id: action.step.id,
        title: action.step.title,
        goal_title: action.step.goalTitle,
        starts_on: startsOn,
        amount: action.amount,
        counted_on: startsOn === action.startsOn ? (action.happenedOn ?? today) : today,
        undone_at: null,
      } };
    }
    case 'progress': {
      // On the step when it named one, else on the goal; dated today unless
      // the sentence said another day. Tied to the capture.
      const itemId = action.step?.id ?? action.goal.id;
      const happenedOn = action.happenedOn ?? today;
      const id = await addProgressEntry(client, userId, {
        itemId,
        text: action.text,
        happenedOn,
        quantity: action.quantity,
        unit: action.unit,
        captureId,
      });
      if (!id) return null;
      // The total filing read from the done-when is set with the entry; if
      // the step has gained one meanwhile, the line says nothing about it.
      let total = progressTotal(action);
      if (total?.total_set && action.step) {
        const set = await setTotalIfNone(client, action.step.id, total.total, total.total_unit);
        if (!set) total = null;
      }
      return { kind: 'log_progress', ref: `goals.progress_entries:${id}`, op: 'insert', entry: {
        kind: 'progress',
        entry_id: id,
        item_id: itemId,
        step_title: action.step?.title ?? null,
        goal_title: action.goal.title,
        text: action.text,
        quantity: action.quantity,
        unit: action.unit,
        happened_on: happenedOn,
        ...(total ?? {}),
        ...(asksEstimate(action, total) ? { ask_estimate: true } : {}),
        undone_at: null,
      } };
    }
    case 'reading': {
      // Read on the day the sentence was filed, tied to the capture.
      const id = await addReading(client, userId, action.goal.id, {
        value: action.value,
        readOn: today,
        captureId,
      });
      if (!id) return null;
      return { kind: 'record_reading', ref: `goals.readings:${id}`, op: 'insert', entry: {
        kind: 'reading',
        reading_id: id,
        goal_id: action.goal.id,
        goal_title: action.goal.title,
        value: action.value,
        unit: action.goal.unit,
        undone_at: null,
      } };
    }
    case 'add': {
      const id = await insertStep(client, userId, action.parent?.id ?? action.goal.id, {
        title: action.title,
        kind: action.stepKind,
      });
      if (!id) return null;
      // Work already done on it is logged at once, so it starts under way
      // (plan #1278). If the entry cannot be written the step still stands
      // and the line says only that it was added.
      const progress = addedProgress(action, id);
      let logged: AddedFiledProgress | undefined;
      if (progress) {
        const happenedOn = progress.happenedOn ?? today;
        const entryId = await addProgressEntry(client, userId, {
          itemId: id,
          text: progress.text,
          happenedOn,
          quantity: progress.quantity,
          unit: progress.unit,
          captureId,
        });
        if (entryId) {
          let total = progressTotal(progress);
          if (total?.total_set) {
            const set = await setTotalIfNone(client, id, total.total, total.total_unit);
            if (!set) total = null;
          }
          logged = {
            entry_id: entryId,
            text: progress.text,
            quantity: progress.quantity,
            unit: progress.unit,
            happened_on: happenedOn,
            ...(total ?? {}),
            ...(asksEstimate(progress, total) ? { ask_estimate: true } : {}),
          };
        }
      }
      return { kind: 'add_step', ref: `goals.items:${id}`, op: 'insert', entry: {
        kind: 'add',
        step_id: id,
        title: action.title,
        step_kind: action.stepKind,
        goal_title: action.goal.title,
        ...(logged ? { progress: logged } : {}),
        undone_at: null,
      } };
    }
  }
}

/** Write the list of what was done onto the capture. */
export async function saveFiled(
  client: GoalsSupabaseClient,
  captureId: string,
  filed: FiledEntry[],
): Promise<void> {
  const { error } = await client.from('captures').update({ filed }).eq('id', captureId);
  if (error) throw new Error(`Could not save what was filed: ${error.message}`);
}

export type UndoResult =
  | { ok: true; filed: FiledEntry[] }
  | { ok: false; error: string };

/**
 * Reverse one line of a capture and mark it undone. Only that line's row is
 * touched: a reopened step goes back to open, a count is taken back from the
 * period it was added to by the number it added, an added step is archived with any progress filed
 * on it, a recorded reading is
 * deleted, a progress entry is marked undone. A note from before plan #1275
 * changes no row.
 */
export async function undoFiled(
  client: GoalsSupabaseClient,
  captureId: string,
  index: number,
  dash: DashActionDeps | null = null,
): Promise<UndoResult> {
  const { data, error } = await client
    .from('captures')
    .select('filed')
    .eq('id', captureId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return { ok: false, error: 'That capture is no longer there.' };

  const filed = readFiled(data.filed);
  const entry = filed[index];
  if (!entry) return { ok: false, error: 'That line is no longer there.' };
  // The record follows the line, also when an earlier Undo could not mark it.
  const markRecord = async () => {
    if (dash && entry.action_id) await markDashActionUndone(dash, entry.action_id);
  };
  if (entry.undone_at) {
    await markRecord();
    return { ok: true, filed };
  }

  const move = undoMove(entry);
  switch (move.move) {
    case 'reopen':
      // False when it was already reopened by hand; either way it is open now.
      await setStepStatus(client, move.stepId, 'open');
      break;
    case 'uncount': {
      // The same number, from the same period, even once it has closed.
      const taken = await countTowards(client, move.stepId, move.startsOn, -move.amount, {
        closed: true,
      });
      if (!taken) {
        return {
          ok: false,
          error: 'There is nothing left to take back in that period.',
        };
      }
      break;
    }
    case 'archive':
      await setStepArchived(client, move.stepId, true);
      // The entry filed on the new step goes with it, so nothing counts it.
      if (move.progress) {
        await undoProgressEntry(client, move.progress.entryId);
        if (move.progress.clearTotal) {
          await clearTotalIfUnchanged(
            client,
            move.progress.clearTotal.stepId,
            move.progress.clearTotal.total,
          );
        }
      }
      break;
    case 'delete-reading':
      // False when it was already deleted by hand; either way it is gone.
      await deleteReading(client, move.readingId);
      break;
    case 'undo-progress':
      // False when it was already undone by hand; either way it no longer counts.
      await undoProgressEntry(client, move.entryId);
      if (move.clearTotal) {
        await clearTotalIfUnchanged(client, move.clearTotal.stepId, move.clearTotal.total);
      }
      break;
    case 'none':
      break;
  }

  const next = markUndone(filed, index, new Date().toISOString());
  if (!next) return { ok: true, filed };
  await saveFiled(client, captureId, next);
  await markRecord();
  return { ok: true, filed: next };
}

/**
 * Undo the line a core.dash_actions record names, for Home's Undo on a
 * capture row (plan #1569): the same reversal as the panel's Undo, found by
 * the record's id rather than the line's place in the list.
 */
export async function undoFiledAction(
  client: GoalsSupabaseClient,
  captureId: string,
  actionId: string,
  dash: DashActionDeps,
): Promise<UndoResult> {
  const { data, error } = await client
    .from('captures')
    .select('filed')
    .eq('id', captureId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return { ok: false, error: 'That capture is no longer there.' };
  const index = readFiled(data.filed).findIndex((entry) => entry.action_id === actionId);
  if (index < 0) return { ok: false, error: 'That line is no longer there.' };
  return undoFiled(client, captureId, index, dash);
}

/**
 * Keep the answer to "Roughly how far along?" (plan #1280) on the entry the
 * line filed, and on the line so the question is not shown again. Refused
 * when the line is not asking: answered already, undone, or never asked.
 */
export async function answerFiledEstimate(
  client: GoalsSupabaseClient,
  captureId: string,
  index: number,
  estimate: ProgressEstimate,
): Promise<UndoResult> {
  const { data, error } = await client
    .from('captures')
    .select('filed')
    .eq('id', captureId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return { ok: false, error: 'That capture is no longer there.' };

  const filed = readFiled(data.filed);
  const entry = filed[index];
  const entryId = entry ? estimateAsked(entry) : null;
  const next = entryId ? withEstimate(filed, index, estimate) : null;
  if (!entryId || !next) return { ok: false, error: 'That line is no longer asking.' };

  const kept = await setProgressEstimate(client, entryId, estimate);
  if (!kept) return { ok: false, error: 'That progress was taken back, so there is nothing to keep it on.' };
  await saveFiled(client, captureId, next);
  return { ok: true, filed: next };
}
