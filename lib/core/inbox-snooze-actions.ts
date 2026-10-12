'use server';

import { revalidatePath } from 'next/cache';
import { createClient, requireUser } from '@/lib/auth/server';
import { parseSnoozeRef } from './inbox-snoozes';
import { currentRowStamps } from './inbox-snoozes-server';

export type SnoozeActionState = { error?: string };

const YEAR_MS = 366 * 24 * 60 * 60 * 1000;

function refresh() {
  // The tab's count lives in the layout, so the layouts are what refresh.
  revalidatePath('/dev', 'layout');
  revalidatePath('/goals', 'layout');
}

/**
 * Hide one inbox row until a later moment (plan #1843). Shared by the Dev and
 * Goals inboxes. The snooze records the row's change stamp as it stands, so a
 * new answer or question on the row lifts it before the day comes.
 * `until` is an ISO moment the person's browser worked out from their day.
 */
export async function snoozeInboxRow(ref: string, until: string): Promise<SnoozeActionState> {
  const user = await requireUser();
  if (!parseSnoozeRef(ref)) return { error: 'That row cannot be snoozed.' };
  const when = new Date(until);
  const now = Date.now();
  if (Number.isNaN(when.getTime()) || when.getTime() <= now) {
    return { error: 'Pick a day that has not started yet.' };
  }
  if (when.getTime() > now + YEAR_MS) return { error: 'Pick a day within the next year.' };

  const supabase = await createClient();
  const stamp = (await currentRowStamps(supabase, user.id, [ref])).get(ref);
  if (!stamp) return { error: 'That row is gone.' };
  const { error } = await supabase
    .schema('core')
    .from('inbox_snoozes')
    .upsert(
      { user_id: user.id, ref, snoozed_until: when.toISOString(), row_updated_at: stamp },
      { onConflict: 'user_id,ref' },
    );
  if (error) return { error: 'Dash could not snooze that. Try again.' };
  refresh();
  return {};
}

/** Take a snooze off, so the row is back in the inbox. */
export async function unsnoozeInboxRow(ref: string): Promise<SnoozeActionState> {
  const user = await requireUser();
  if (!parseSnoozeRef(ref)) return { error: 'That row cannot be snoozed.' };
  const supabase = await createClient();
  const { error } = await supabase
    .schema('core')
    .from('inbox_snoozes')
    .delete()
    .eq('user_id', user.id)
    .eq('ref', ref);
  if (error) return { error: 'Dash could not unsnooze that. Try again.' };
  refresh();
  return {};
}
