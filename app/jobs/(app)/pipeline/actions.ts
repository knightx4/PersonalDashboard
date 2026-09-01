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
  // The company page shows the same statuses and can now set them, so it has
  // to be revalidated too -- otherwise a change made there appears to do
  // nothing until something else forces a refresh.
  revalidatePath('/jobs/companies/[slug]', 'page');
  revalidatePath('/jobs/today');
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

/**
 * Remove a pursuit that should never have existed.
 *
 * The inbox now opens pursuits on its own, which is the feature — and the
 * price of it is that it will sometimes be wrong. Until now the only way to
 * undo that was from the review queue, and only while the row was still
 * flagged; once you confirmed it, or once it aged out of the queue, a company
 * you never applied to sat in the pipeline permanently and skewed every funnel
 * number computed from it.
 *
 * Deleting the row is not enough on its own. The message that created it is
 * still in the ledger pointing at it, so the next reprocess could reasonably
 * make it again. So the mail is disclaimed at the same time: this is the
 * user's answer to "is this real", and it should stick.
 */
export async function dismissPursuit(
  applicationId: string,
): Promise<{ error: string | null; removed?: string }> {
  const parsed = z.string().uuid().safeParse(applicationId);
  if (!parsed.success) return { error: 'That is not a pursuit.' };

  const user = await requireUser();
  const supabase = await createClient();

  const { data: application } = await supabase
    .from('applications')
    .select('id, role_id, roles!inner ( id, title, company_id, companies!inner ( id, name ) )')
    .eq('id', parsed.data)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!application) return { error: 'That pursuit no longer exists.' };

  const role = application.roles as unknown as {
    id: string;
    title: string;
    company_id: string;
    companies: { id: string; name: string };
  };

  // Disclaim the mail first. If the delete below fails we have marked some
  // messages irrelevant and changed nothing else, which is recoverable from
  // the review queue; the reverse order can leave mail pointing at a row that
  // is gone.
  const { data: linked } = await supabase
    .from('inbox_messages')
    .select('id')
    .eq('resulting_application_id', parsed.data);

  const messageIds = (linked ?? []).map((row) => row.id as string);
  if (messageIds.length > 0) {
    await supabase
      .from('ingested_messages')
      .update({
        classification: 'not_relevant',
        parse_status: 'skipped',
        resulting_application_id: null,
        error: 'Dismissed: you said this was not a real pursuit.',
      })
      .in('id', messageIds);
  }

  const { error } = await supabase
    .from('applications')
    .delete()
    .eq('id', parsed.data)
    .eq('user_id', user.id);
  if (error) return { error: error.message };

  // The role and the company were created for this pursuit and are worth
  // removing with it -- but only when nothing else has attached to them since.
  // A company you have researched, or have a contact at, is yours now whatever
  // the inbox thought.
  const { count: rolesLeft } = await supabase
    .from('applications')
    .select('id', { count: 'exact', head: true })
    .eq('role_id', role.id);

  if ((rolesLeft ?? 0) === 0) {
    await supabase.from('roles').delete().eq('id', role.id).eq('user_id', user.id);
    await deleteCompanyIfOrphaned(supabase, user.id, role.companies.id);
  }

  revalidatePath('/jobs/pipeline');
  revalidatePath('/jobs/roles');
  revalidatePath('/jobs/companies');
  revalidatePath('/jobs/review');

  return { error: null, removed: `${role.companies.name} · ${role.title}` };
}

/** A company is only removed when it holds nothing a person put there. */
async function deleteCompanyIfOrphaned(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  companyId: string,
): Promise<void> {
  const [{ count: roles }, { count: contacts }, { count: notes }, { data: company }] =
    await Promise.all([
      supabase.from('roles').select('id', { count: 'exact', head: true }).eq('company_id', companyId),
      supabase
        .from('contacts')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', companyId),
      supabase.from('notes').select('id', { count: 'exact', head: true }).eq('company_id', companyId),
      supabase.from('companies').select('research, priority').eq('id', companyId).maybeSingle(),
    ]);

  if ((roles ?? 0) > 0 || (contacts ?? 0) > 0 || (notes ?? 0) > 0) return;
  if ((company?.research as string | null)?.trim()) return;
  // A priority you set is a decision about the company, not about the pursuit.
  if (company?.priority && company.priority !== 'interested') return;

  await supabase.from('companies').delete().eq('id', companyId).eq('user_id', userId);
}

/**
 * Which shape to draw the pipeline in.
 *
 * Stored on the profile rather than in the URL: the board is reached by a link
 * from another page, so a query parameter would forget the choice every time,
 * and this is a standing preference rather than a filter.
 */
export async function setPipelineView(
  view: 'board' | 'list',
): Promise<{ error: string | null }> {
  if (view !== 'board' && view !== 'list') return { error: 'Unknown view.' };

  const user = await requireUser();
  const supabase = await createClient();

  const { error } = await supabase
    .from('profiles')
    .update({ pipeline_view: view })
    .eq('id', user.id);

  if (error) return { error: error.message };
  revalidatePath('/jobs/pipeline');
  return { error: null };
}
