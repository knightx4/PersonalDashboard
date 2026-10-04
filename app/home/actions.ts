'use server';

import { revalidatePath } from 'next/cache';
import { getUser, requireUser } from '@/lib/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { isDay, isPickKey } from '@/lib/day-brief/opens';
import { requestDashDeps } from '@/lib/ask/clients';
import { changePaths } from '@/lib/ask/changes';
import { undoneByVault, type DashAction, type DashActionDeps } from '@/lib/core/dash-actions';
import { undoVaultCapture } from '@/lib/capture/vault';
import { createGoalsClient } from '@/lib/goals/auth/server';
import { undoFiledAction } from '@/lib/goals/capture-store';
import { undoDashTodayWith, type DashTodayUndo } from '@/lib/shell/dash-today';
import { undoAskChange } from '@/lib/talk/ask-request';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Record that a pick on the morning brief was followed (plan #1242).
 *
 * Stamps opened_at on that pick inside the day's picks, the first time only,
 * through core.open_day_brief_pick, which runs as the caller and touches only
 * their own brief. The person has read access alone on core.day_briefs, which
 * is why this goes through the function rather than an update.
 *
 * The link navigates whether or not this lands, so it never throws: a failed
 * stamp costs one entry in a record nothing reads yet.
 */
// latency: instant -- fired as the link is followed; nothing waits for it
export async function openBriefPick(day: string, key: string): Promise<void> {
  if (!isDay(day) || !isPickKey(key)) return;
  const user = await getUser();
  if (!user) return;
  try {
    const core = await createCoreClient();
    const { error } = await core.rpc('open_day_brief_pick', { p_day: day, p_key: key });
    if (error) console.error('recording the opened pick failed', error.message);
  } catch (err) {
    console.error('recording the opened pick failed', err);
  }
}

export type StopWatchResult = { ok: true } | { ok: false; error: string };

/**
 * Stop a running watch from its row in the Watching section (plan #1296).
 *
 * Sets the status to 'stopped' as the person, which RLS keeps to their own
 * watches; the hourly run then leaves it alone, and the touched updated_at
 * puts it in Updates as "You stopped watching …" (lib/shell/watching.ts).
 * Only a running watch is stopped, so a watch that ended in the meantime
 * keeps its ending.
 */
// latency: pending
export async function stopWatch(formData: FormData): Promise<StopWatchResult> {
  const id = formData.get('id');
  if (typeof id !== 'string' || !UUID.test(id)) return { ok: false, error: 'Could not tell which watch that was.' };
  const user = await requireUser();
  const core = await createCoreClient();
  const { data, error } = await core
    .from('watches')
    .update({ status: 'stopped' })
    .eq('id', id)
    .eq('user_id', user.id)
    .eq('status', 'running')
    .select('id');
  if (error) return { ok: false, error: 'The watch could not be stopped. Try again.' };
  revalidatePath('/home');
  if ((data ?? []).length === 0) return { ok: false, error: 'That watch is not running any more.' };
  return { ok: true };
}

/**
 * Undo a line filed from capture, from its record (plan #1569): the same
 * reversal as the capture panel's Undo, through a client made as the capture
 * actor so goals.history ties it to the same sentence.
 */
async function undoCaptureLine(deps: DashActionDeps, action: DashAction): Promise<DashTodayUndo> {
  // A note capture wrote into the vault: its file comes out of the repository too (plan #1582).
  if (undoneByVault(action)) {
    const undone = await undoVaultCapture(deps, action);
    if (!undone.ok) return { ok: false, error: undone.error };
    return { ok: true, paths: ['/vault'] };
  }
  const captureId = action.undo?.capture_id;
  if (typeof captureId !== 'string' || !UUID.test(captureId)) {
    return { ok: false, error: 'Dash did not keep which capture this came from, so it cannot be undone here.' };
  }
  const client = await createGoalsClient({ actor: 'capture', captureId });
  const result = await undoFiledAction(client, captureId, action.id, deps);
  if (!result.ok) return { ok: false, error: result.error };
  revalidatePath('/goals', 'layout');
  revalidatePath('/todo', 'layout');
  return { ok: true, paths: [] };
}

export type UndoDashTodayResult = { ok: true } | { ok: false; error: string };

/**
 * Undo one of today's Dash changes from its row on Home (plan #1461), by
 * lib/shell/dash-today.ts: the generic undo for every surface, and Ask
 * Dash's own for its changes. A refusal comes back as the sentence the
 * person reads.
 */
// latency: pending
export async function undoDashToday(id: string): Promise<UndoDashTodayResult> {
  if (typeof id !== 'string' || !UUID.test(id)) return { ok: false, error: 'That change is not there any more.' };
  const user = await requireUser();
  try {
    const deps = await requestDashDeps(user.id);
    const result = await undoDashTodayWith(
      deps,
      id,
      undoAskChange,
      (outcome) => changePaths(outcome.change),
      (action) => undoCaptureLine(deps, action),
    );
    if (!result.ok) return result;
    for (const path of result.paths) revalidatePath(path);
    revalidatePath('/home');
    return { ok: true };
  } catch (error) {
    console.error('undoing a Dash change from Home failed', error);
    return { ok: false, error: 'The change could not be undone. Check your connection and try again.' };
  }
}
