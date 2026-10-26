'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, requireUser } from '@/lib/jobs/auth/server';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { recordSessionSpend } from '@/lib/core/spend/session';
import { saveTouchEdit } from '@/lib/jobs/contacts/edit';
import { chooseFollowUpPerson, startOwnNote } from '@/lib/jobs/followup/choose';
import { designateFollowUp, draftNote } from '@/lib/jobs/followup/designate';
import { loadFollowUps, type FollowUp } from '@/lib/jobs/followup/load';
import { channelFor, followUpAim } from '@/lib/jobs/followup/person';
import { roleStage } from '@/lib/jobs/role-stage';

/**
 * The follow-up on an application: who to tell, and the note to them
 * (lib/jobs/followup). Used from the role page and from the Follow-ups list,
 * and each answers with the follow-up as it now stands so either can redraw.
 */

const Id = z.string().uuid();

/** Long enough for a web search inside the page's request. */
const SEARCH_BUDGET_MS = 200_000;

function refresh() {
  revalidatePath('/jobs/follow-ups');
  revalidatePath('/jobs/roles/[id]', 'page');
  revalidatePath('/jobs/contacts/[id]', 'page');
}

async function current(applicationId: string, userId: string): Promise<FollowUp | undefined> {
  const supabase = await createClient();
  return (await loadFollowUps(supabase, userId, { applicationIds: [applicationId] }))[0];
}

/**
 * Name the person and draft the note: someone on file when anyone there will
 * do, else the hiring manager Dash finds on the web. With `replace`, the
 * person named now is passed over.
 */
// latency: pending -- a web search and a draft; the button says it is working
export async function findFollowUp(
  applicationId: string,
  replace = false,
): Promise<{ error: string | null; note?: string; followUp?: FollowUp }> {
  if (!Id.safeParse(applicationId).success) return { error: 'That is not an application.' };
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { error: 'Drafting is not configured.' };

  const user = await requireUser();
  const supabase = await createClient();
  const searchSpend: SpendReport[] = [];
  const draftSpend: SpendReport[] = [];
  const result = await designateFollowUp(supabase, user.id, applicationId, {
    apiKey,
    allowSearch: true,
    replace,
    deadline: Date.now() + SEARCH_BUDGET_MS,
    onSearchSpend: (report) => searchSpend.push(report),
    onDraftSpend: (report) => draftSpend.push(report),
  });
  await recordSessionSpend(user.id, { module: 'jobs', operation: 'find-follow-up-person' }, searchSpend);
  await recordSessionSpend(user.id, { module: 'jobs', operation: 'draft-outreach' }, draftSpend);
  refresh();
  const followUp = await current(applicationId, user.id);
  if (!result.ok) return { error: result.error, followUp };
  return {
    error: null,
    note: result.draftError ? `The note was not written: ${result.draftError}` : undefined,
    followUp,
  };
}

const Chosen = z.union([
  z.object({ contactId: z.string().uuid() }),
  z.object({
    name: z.string().trim().min(1, 'A name is needed.').max(200),
    title: z.string().trim().max(200).optional(),
    linkedinUrl: z.string().trim().url('That LinkedIn link is not a web address.').optional().or(z.literal('')),
    email: z.string().trim().email('That email does not look right.').optional().or(z.literal('')),
  }),
]);

/**
 * Name the person by hand: one of their contacts, or someone new, who is
 * added as a contact at the company (lib/jobs/followup/choose.ts). No note
 * is written; the card offers one after.
 */
// latency: pending -- one write; the card redraws from what comes back
export async function setFollowUpPerson(
  applicationId: string,
  who: z.input<typeof Chosen>,
): Promise<{ error: string | null; followUp?: FollowUp }> {
  if (!Id.safeParse(applicationId).success) return { error: 'That is not an application.' };
  const parsed = Chosen.safeParse(who);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const user = await requireUser();
  const supabase = await createClient();
  const result = await chooseFollowUpPerson(supabase, user.id, applicationId, parsed.data);
  if (result.error) return { error: result.error };
  refresh();
  return { error: null, followUp: await current(applicationId, user.id) };
}

/** Open a blank note to the person named, to write without Dash. */
// latency: pending -- one write
export async function writeOwnFollowUp(applicationId: string): Promise<{ error: string | null; followUp?: FollowUp }> {
  if (!Id.safeParse(applicationId).success) return { error: 'That is not an application.' };
  const user = await requireUser();
  const supabase = await createClient();
  const { error } = await startOwnNote(supabase, user.id, applicationId);
  if (error) return { error };
  refresh();
  return { error: null, followUp: await current(applicationId, user.id) };
}

/** Write the note to the person named again, in place of the draft there. */
// latency: pending -- a draft
export async function redraftFollowUp(applicationId: string): Promise<{ error: string | null; followUp?: FollowUp }> {
  if (!Id.safeParse(applicationId).success) return { error: 'That is not an application.' };
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { error: 'Drafting is not configured.' };

  const user = await requireUser();
  const supabase = await createClient();
  const followUp = await current(applicationId, user.id);
  if (!followUp?.person) return { error: 'Nobody is named for this application yet.' };
  const { data: contact } = await supabase
    .from('contacts')
    .select('email, relationship, status, linkedin_connection')
    .eq('id', followUp.person.id)
    .eq('user_id', user.id)
    .maybeSingle();
  const c = (contact ?? { email: null, relationship: 'cold', status: 'to_contact', linkedin_connection: false }) as {
    email: string | null;
    relationship: string;
    status: string;
    linkedin_connection: boolean;
  };

  const spend: SpendReport[] = [];
  const note = await draftNote(supabase, user.id, {
    applicationId,
    contactId: followUp.person.id,
    channel:
      (followUp.draft?.channel as Parameters<typeof draftNote>[2]['channel'] | undefined) ??
      channelFor({ email: c.email, relationship: c.relationship, status: c.status, linkedinConnection: c.linkedin_connection }),
    aim: followUpAim({ role: followUp.role, company: followUp.company, applied: roleStage(followUp.status) !== 'lead' }),
    apiKey,
    onSpend: (report) => spend.push(report),
  });
  await recordSessionSpend(user.id, { module: 'jobs', operation: 'draft-outreach' }, spend);
  refresh();
  return { error: note.error, followUp: await current(applicationId, user.id) };
}

/** Keep the person's own edits to the note. */
// latency: optimistic -- the words are already on the page
export async function saveFollowUpNote(touchId: string, message: string): Promise<{ error: string | null }> {
  if (!Id.safeParse(touchId).success) return { error: 'That is not a draft.' };
  const user = await requireUser();
  const supabase = await createClient();
  const { error } = await saveTouchEdit(supabase, user.id, touchId, { message: message.trim() || null });
  if (!error) refresh();
  return { error };
}
