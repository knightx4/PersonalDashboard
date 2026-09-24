import 'server-only';

import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import {
  captureContext,
  markUndone,
  readFiled,
  undoMove,
  type CaptureContext,
  type FiledEntry,
  type PlannedAction,
} from '@/lib/goals/capture';
import { liveRhythms } from '@/lib/goals/rhythms';
import { countTowards, syncRhythms } from '@/lib/goals/rhythms-store';
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
  const { goals, byGoal } = await loadLiveTree(client);
  const live = liveRhythms(
    goals.map((g) => g.goal),
    byGoal,
  );
  const records = await syncRhythms(client, userId, live, today);
  return captureContext(goals, byGoal, records);
}

/** Carry out one move. Null when it no longer applies. */
export async function applyCaptureAction(
  client: GoalsSupabaseClient,
  userId: string,
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
    case 'note':
      // Kept on the capture itself: a note changes no goal or step.
      return {
        kind: 'note',
        goal_id: action.goal.id,
        goal_title: action.goal.title,
        text: action.text,
        undone_at: null,
      };
    case 'add': {
      const id = await insertStep(client, userId, action.parent?.id ?? action.goal.id, {
        title: action.title,
        kind: action.stepKind,
      });
      if (!id) return null;
      return {
        kind: 'add',
        step_id: id,
        title: action.title,
        step_kind: action.stepKind,
        goal_title: action.goal.title,
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
 * period it was added to, an added step is archived. A note changes no row.
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
      break;
    case 'none':
      break;
  }

  const next = markUndone(filed, index, new Date().toISOString());
  if (!next) return { ok: true, filed };
  await saveFiled(client, captureId, next);
  return { ok: true, filed: next };
}
