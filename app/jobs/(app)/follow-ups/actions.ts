'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, requireUser } from '@/lib/jobs/auth/server';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { recordSessionSpend } from '@/lib/core/spend/session';
import { saveTouchEdit, TOUCH_CHANNELS } from '@/lib/jobs/contacts/edit';
import { addFollowUpPerson as addPerson, removeFollowUpPerson as removePerson, startOwnNote } from '@/lib/jobs/followup/choose';
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
 * Find the best person to reach out to and draft the note: the recruiter or
 * hiring manager on file, else whoever Dash finds on the web. With
 * `another`, one more person beside those already named.
 */
// latency: pending -- a web search and a draft; the button says it is working
export async function findFollowUp(
  applicationId: string,
  another = false,
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
    another,
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
 * Add someone to reach out to by hand: one of their contacts, or someone
 * new, who is added as a contact at the company (lib/jobs/followup/choose.ts).
 * No note is written; the tab offers one after.
 */
// latency: pending -- one write; the tab redraws from what comes back
export async function addFollowUpPerson(
  applicationId: string,
  who: z.input<typeof Chosen>,
): Promise<{ error: string | null; followUp?: FollowUp }> {
  if (!Id.safeParse(applicationId).success) return { error: 'That is not an application.' };
  const parsed = Chosen.safeParse(who);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const user = await requireUser();
  const supabase = await createClient();
  const result = await addPerson(supabase, user.id, applicationId, parsed.data);
  if (result.error) return { error: result.error };
  refresh();
  return { error: null, followUp: await current(applicationId, user.id) };
}

/** Take someone off the list, with their unsent note about this application. */
// latency: pending -- one write
export async function removeFollowUpPerson(
  applicationId: string,
  contactId: string,
): Promise<{ error: string | null; followUp?: FollowUp }> {
  if (!Id.safeParse(applicationId).success || !Id.safeParse(contactId).success) return { error: 'That is not a contact.' };
  const user = await requireUser();
  const supabase = await createClient();
  const { error } = await removePerson(supabase, user.id, applicationId, contactId);
  if (error) return { error };
  refresh();
  return { error: null, followUp: await current(applicationId, user.id) };
}

/** Open a blank note to one person on the list, to write without Dash. */
// latency: pending -- one write
export async function writeOwnFollowUp(
  applicationId: string,
  contactId: string,
): Promise<{ error: string | null; followUp?: FollowUp }> {
  if (!Id.safeParse(applicationId).success || !Id.safeParse(contactId).success) return { error: 'That is not a contact.' };
  const user = await requireUser();
  const supabase = await createClient();
  const { error } = await startOwnNote(supabase, user.id, applicationId, contactId);
  if (error) return { error };
  refresh();
  return { error: null, followUp: await current(applicationId, user.id) };
}

/** Write the note to one person on the list again, in place of the draft there. */
// latency: pending -- a draft
export async function redraftFollowUp(
  applicationId: string,
  contactId: string,
): Promise<{ error: string | null; followUp?: FollowUp }> {
  if (!Id.safeParse(applicationId).success || !Id.safeParse(contactId).success) return { error: 'That is not a contact.' };
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { error: 'Drafting is not configured.' };

  const user = await requireUser();
  const supabase = await createClient();
  const followUp = await current(applicationId, user.id);
  const person = followUp?.people.find((p) => p.contactId === contactId);
  if (!followUp || !person) return { error: 'They are not on this application’s list.' };
  const { data: contact } = await supabase
    .from('contacts')
    .select('email, relationship, status, linkedin_connection')
    .eq('id', contactId)
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
    contactId,
    channel:
      (person.draft?.channel as Parameters<typeof draftNote>[2]['channel'] | undefined) ??
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

/** Change how the note goes: a LinkedIn message, an email, a connection note (note a790ab92). */
// latency: optimistic -- the choice is already on the page
export async function saveFollowUpChannel(touchId: string, channel: string): Promise<{ error: string | null }> {
  if (!Id.safeParse(touchId).success) return { error: 'That is not a draft.' };
  if (!z.enum(TOUCH_CHANNELS).safeParse(channel).success) return { error: 'That is not a way to send it.' };
  const user = await requireUser();
  const supabase = await createClient();
  const { error } = await saveTouchEdit(supabase, user.id, touchId, { channel });
  if (!error) refresh();
  return { error };
}
