'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, requireUser } from '@/lib/jobs/auth/server';
import { APPLICATION_STATUSES, type ApplicationStatus } from '@/lib/jobs/pipeline';

/**
 * Moving a card writes a status_override EVENT and sets the override column.
 * It never writes `status` — that column is owned by
 * public.sync_application_state(), which recomputes it from the event log the
 * moment the override lands.
 */
const moveSchema = z.object({
  applicationId: z.string().uuid(),
  status: z.enum(APPLICATION_STATUSES),
});

export async function moveApplication(
  applicationId: string,
  status: ApplicationStatus,
): Promise<{ error: string | null }> {
  const parsed = moveSchema.safeParse({ applicationId, status });
  if (!parsed.success) return { error: 'That is not a status this board can set.' };

  // 'ghosted' is derived from silence and is deliberately not settable by hand.
  // Letting it be set manually means nobody maintains it, and the funnel then
  // treats abandoned pursuits as live ones.
  if (parsed.data.status === 'ghosted') {
    return { error: 'Ghosted is worked out from silence, so it cannot be set by hand.' };
  }

  const user = await requireUser();
  const supabase = await createClient();

  const { error: eventError } = await supabase.from('application_events').insert({
    user_id: user.id,
    application_id: parsed.data.applicationId,
    kind: 'status_override',
    occurred_at: new Date().toISOString(),
    source: 'manual',
    summary: `Moved to ${parsed.data.status.replace(/_/g, ' ')} by hand`,
    payload: { status: parsed.data.status },
  });
  if (eventError) return { error: eventError.message };

  const { error } = await supabase
    .from('applications')
    .update({ status_manual_override: parsed.data.status })
    .eq('id', parsed.data.applicationId)
    .eq('user_id', user.id);

  if (error) return { error: error.message };

  revalidatePath('/jobs/pipeline');
  revalidatePath('/jobs/roles');
  return { error: null };
}

export async function setExcitement(
  applicationId: string,
  excitement: number | null,
): Promise<{ error: string | null }> {
  if (excitement !== null && (excitement < 1 || excitement > 5)) {
    return { error: 'Excitement runs from 1 to 5.' };
  }
  const user = await requireUser();
  const supabase = await createClient();
  const { error } = await supabase
    .from('applications')
    .update({ excitement })
    .eq('id', applicationId)
    .eq('user_id', user.id);
  if (error) return { error: error.message };
  revalidatePath('/jobs/pipeline');
  return { error: null };
}

export async function setNextAction(
  applicationId: string,
  nextAction: string | null,
  dueDate: string | null,
): Promise<{ error: string | null }> {
  const user = await requireUser();
  const supabase = await createClient();
  const { error } = await supabase
    .from('applications')
    .update({
      next_action: nextAction?.trim() || null,
      next_action_due: dueDate || null,
    })
    .eq('id', applicationId)
    .eq('user_id', user.id);
  if (error) return { error: error.message };
  revalidatePath('/jobs/pipeline');
  return { error: null };
}
