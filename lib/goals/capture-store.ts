import 'server-only';

import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import {
  MAX_CONTEXT_STEPS,
  addedProgress,
  captureContext,
  markUndone,
  progressTotal,
  readFiled,
  undoMove,
  type AddedFiledProgress,
  type CaptureContext,
  type FiledEntry,
  type PlannedAction,
} from '@/lib/goals/capture';
import { summariseProgress } from '@/lib/goals/progress';
import {
  addProgressEntry,
  clearTotalIfUnchanged,
  loadProgressEntries,
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

/** Carry out one move. Null when it no longer applies. */
export async function applyCaptureAction(
  client: GoalsSupabaseClient,
  { userId, today, captureId }: Today & { captureId: string },
  action: PlannedAction,
): Promise<FiledEntry | null> {
  switch (action.kind) {
    case 'close': {
      const changed = await setStepStatus(client, action.step.id, 'done');
      if (!changed) return null;
      return {
        kind: 'close',
        step_id: action.step.id,
        title: action.step.title,
        goal_title: action.step.goalTitle,
        undone_at: null,
      };
    }
    case 'count': {
      const rhythm = action.step.rhythm;
      if (!rhythm) return null;
      const counted = await countTowards(client, action.step.id, rhythm.startsOn, 1);
      if (!counted) return null;
      return {
        kind: 'count',
        step_id: action.step.id,
        title: action.step.title,
        goal_title: action.step.goalTitle,
        starts_on: rhythm.startsOn,
        undone_at: null,
      };
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
      return {
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
        undone_at: null,
      };
    }
    case 'reading': {
      // Read on the day the sentence was filed, tied to the capture.
      const id = await addReading(client, userId, action.goal.id, {
        value: action.value,
        readOn: today,
        captureId,
      });
      if (!id) return null;
      return {
        kind: 'reading',
        reading_id: id,
        goal_id: action.goal.id,
        goal_title: action.goal.title,
        value: action.value,
        unit: action.goal.unit,
        undone_at: null,
      };
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
          };
        }
      }
      return {
        kind: 'add',
        step_id: id,
        title: action.title,
        step_kind: action.stepKind,
        goal_title: action.goal.title,
        ...(logged ? { progress: logged } : {}),
        undone_at: null,
      };
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
 * period it was added to, an added step is archived with any progress filed
 * on it, a recorded reading is
 * deleted, a progress entry is marked undone. A note from before plan #1275
 * changes no row.
 */
export async function undoFiled(
  client: GoalsSupabaseClient,
  captureId: string,
  index: number,
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
  if (entry.undone_at) return { ok: true, filed };

  const move = undoMove(entry);
  switch (move.move) {
    case 'reopen':
      // False when it was already reopened by hand; either way it is open now.
      await setStepStatus(client, move.stepId, 'open');
      break;
    case 'uncount': {
      const taken = await countTowards(client, move.stepId, move.startsOn, -1);
      if (!taken) {
        return {
          ok: false,
          error: 'That period has closed, so the count stays.',
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
  return { ok: true, filed: next };
}
