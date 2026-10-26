/**
 * Name the person an application is followed up with, and draft the note.
 *
 * The person comes from the contacts on file when anyone there will do
 * (person.ts), and otherwise from a web search for the hiring manager
 * (find-person.ts), who is then added as a contact Dash found. The choice is
 * kept on the application (follow_up_contact_id, follow_up_why) and the note
 * as a draft touch on that contact with the application's id, so it is
 * edited, copied and marked sent like any other draft, and the role page,
 * the contact page and the Follow-ups list all read the same row.
 *
 * Called from the role page and the Follow-ups list (follow-ups/actions.ts)
 * and from the daily job suggestions run, for applications that went in
 * lately with nobody named (inngest/jobs/suggestions.ts).
 */
import 'server-only';

import type { SpendSink } from '@/lib/core/spend/pricing';
import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import { addContact, addTouch, saveTouchEdit } from '@/lib/jobs/contacts/edit';
import { draftOutreach } from '@/lib/jobs/contacts/draft-outreach';
import { roleStage } from '@/lib/jobs/role-stage';
import type { ApplicationStatus } from '@/lib/jobs/pipeline';
import { loadSeeker } from '@/lib/jobs/suggest/run';
import type { Channel } from '@/lib/jobs/suggest/payload';
import { lastCorrespondents } from './recipients';
import { findFollowUpPerson } from './find-person';
import { channelFor, followUpAim, pickOnFile, type FileContact } from './person';

export type DesignateOptions = {
  apiKey: string;
  /** Search the web when nobody on file will do. Off, the run stops at the contacts. */
  allowSearch: boolean;
  /** Pass over the person named now and choose again. */
  replace?: boolean;
  /** Epoch milliseconds the web search must be done by. */
  deadline?: number;
  /** What the web search cost; recorded as 'find-follow-up-person'. */
  onSearchSpend?: SpendSink;
  /** What the draft cost; recorded as 'draft-outreach'. */
  onDraftSpend?: SpendSink;
};

export type DesignateResult =
  | { ok: true; contactId: string; touchId: string | null; from: 'file' | 'web'; draftError: string | null }
  | { ok: false; error: string; searched: boolean };

type ApplicationFacts = {
  id: string;
  status: ApplicationStatus;
  referralContactId: string | null;
  followUpContactId: string | null;
  role: string;
  jdText: string | null;
  companyId: string;
  company: string;
  website: string | null;
};

async function loadApplication(supabase: AppSupabaseClient, userId: string, applicationId: string): Promise<ApplicationFacts | null> {
  const { data } = await supabase
    .from('applications')
    .select('id, status, referral_contact_id, follow_up_contact_id, roles!inner ( title, jd_text, company_id, companies!inner ( name, website ) )')
    .eq('id', applicationId)
    .eq('user_id', userId)
    .maybeSingle();
  if (!data) return null;
  const row = data as unknown as {
    id: string;
    status: ApplicationStatus;
    referral_contact_id: string | null;
    follow_up_contact_id: string | null;
    roles: { title: string; jd_text: string | null; company_id: string; companies: { name: string; website: string | null } };
  };
  return {
    id: row.id,
    status: row.status,
    referralContactId: row.referral_contact_id,
    followUpContactId: row.follow_up_contact_id,
    role: row.roles.title,
    jdText: row.roles.jd_text,
    companyId: row.roles.company_id,
    company: row.roles.companies.name,
    website: row.roles.companies.website,
  };
}

async function loadCompanyContacts(supabase: AppSupabaseClient, userId: string, companyId: string): Promise<FileContact[]> {
  const { data } = await supabase
    .from('contacts')
    .select('id, full_name, title, email, linkedin_url, relationship, status, linkedin_connection')
    .eq('user_id', userId)
    .eq('company_id', companyId);
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    id: row.id as string,
    fullName: row.full_name as string,
    title: (row.title as string | null) ?? null,
    email: (row.email as string | null) ?? null,
    linkedinUrl: (row.linkedin_url as string | null) ?? null,
    relationship: row.relationship as string,
    status: row.status as string,
    linkedinConnection: row.linkedin_connection === true,
  }));
}

export async function designateFollowUp(
  supabase: AppSupabaseClient,
  userId: string,
  applicationId: string,
  options: DesignateOptions,
): Promise<DesignateResult> {
  const app = await loadApplication(supabase, userId, applicationId);
  if (!app) return { ok: false, error: 'That application is not on file.', searched: false };

  const passedOver = options.replace ? app.followUpContactId : null;
  const contacts = (await loadCompanyContacts(supabase, userId, app.companyId)).filter((c) => c.id !== passedOver);
  const correspondent = (await lastCorrespondents(supabase, userId, [app.id])).get(app.id)?.fromAddress ?? null;

  let chosen: { contactId: string; why: string; channel: Channel; from: 'file' | 'web' } | null = null;
  const onFile = pickOnFile({
    contacts,
    company: app.company,
    referralContactId: app.referralContactId === passedOver ? null : app.referralContactId,
    correspondentEmail: correspondent,
  });
  if (onFile) chosen = { ...onFile, from: 'file' };

  let searched = false;
  if (!chosen && options.allowSearch) {
    searched = true;
    const seeker = await loadSeeker(supabase, userId);
    const known = contacts.map((c) => c.fullName);
    if (passedOver) {
      const { data: old } = await supabase.from('contacts').select('full_name').eq('id', passedOver).eq('user_id', userId).maybeSingle();
      if (old) known.push((old as { full_name: string }).full_name);
    }
    const found = await findFollowUpPerson(
      { apiKey: options.apiKey, onSpend: options.onSearchSpend, deadline: options.deadline },
      { seeker, company: app.company, website: app.website, role: app.role, jdText: app.jdText, known },
    );
    if (found.ok && found.suggestions.length > 0) {
      const person = found.suggestions[0];
      const { row, error } = await addContact(supabase, userId, {
        company_id: app.companyId,
        full_name: person.name,
        title: person.title,
        linkedin_url: person.linkedinUrl,
        relationship: 'cold',
        status: 'to_contact',
        found_by_dash: true,
        notes: person.sourceUrl ? `Found by Dash to follow up on ${app.role}: ${person.sourceUrl}` : `Found by Dash to follow up on ${app.role}.`,
      });
      if (error || !row) return { ok: false, error: error ?? 'The contact was not kept.', searched };
      chosen = {
        contactId: row.id as string,
        why: person.why,
        channel: channelFor({ email: null, relationship: 'cold', status: 'to_contact', linkedinConnection: false }),
        from: 'web',
      };
    } else if (!found.ok) {
      // Out of time is not a look that found nobody: the next run tries again.
      if (found.queue) return { ok: false, error: 'The search needed more time than it had. Try again.', searched };
      await markTried(supabase, userId, app.id);
      return { ok: false, error: found.error, searched };
    }
  }

  if (!chosen) {
    await markTried(supabase, userId, app.id);
    return {
      ok: false,
      error: searched ? 'Dash could not name anyone there with confidence.' : 'Nobody on file at this company.',
      searched,
    };
  }

  const { error: saveError } = await supabase
    .from('applications')
    .update({ follow_up_contact_id: chosen.contactId, follow_up_why: chosen.why, follow_up_tried_at: new Date().toISOString() })
    .eq('id', app.id)
    .eq('user_id', userId);
  if (saveError) return { ok: false, error: saveError.message, searched };

  const note = await draftNote(supabase, userId, {
    applicationId: app.id,
    contactId: chosen.contactId,
    channel: chosen.channel,
    aim: followUpAim({ role: app.role, company: app.company, applied: roleStage(app.status) !== 'lead' }),
    apiKey: options.apiKey,
    onSpend: options.onDraftSpend,
  });
  return {
    ok: true,
    contactId: chosen.contactId,
    touchId: note.touchId,
    from: chosen.from,
    draftError: note.error,
  };
}

/**
 * Write the note to the person named, into the application's draft to them:
 * the one already there is rewritten, so drafting again never piles up
 * drafts.
 */
export async function draftNote(
  supabase: AppSupabaseClient,
  userId: string,
  input: { applicationId: string; contactId: string; channel: Channel; aim: string; apiKey: string; onSpend?: SpendSink },
): Promise<{ touchId: string | null; error: string | null }> {
  const drafted = await draftOutreach(
    supabase,
    userId,
    { contactId: input.contactId, channel: input.channel, aim: input.aim },
    { apiKey: input.apiKey, onSpend: input.onSpend },
  );
  if (!drafted.ok) return { touchId: null, error: drafted.error };
  const message = drafted.draft.subject ? `Subject: ${drafted.draft.subject}\n\n${drafted.draft.message}` : drafted.draft.message;

  const { data: existing } = await supabase
    .from('contact_touches')
    .select('id')
    .eq('user_id', userId)
    .eq('application_id', input.applicationId)
    .eq('contact_id', input.contactId)
    .eq('draft', true)
    .order('sent_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing) {
    const id = (existing as { id: string }).id;
    const { error } = await saveTouchEdit(supabase, userId, id, { channel: input.channel, message });
    return { touchId: error ? null : id, error };
  }
  const { row, error } = await addTouch(supabase, userId, {
    contact_id: input.contactId,
    application_id: input.applicationId,
    channel: input.channel,
    direction: 'outbound',
    message,
    draft: true,
  });
  return { touchId: (row?.id as string | undefined) ?? null, error };
}

function markTried(supabase: AppSupabaseClient, userId: string, applicationId: string) {
  return supabase
    .from('applications')
    .update({ follow_up_tried_at: new Date().toISOString() })
    .eq('id', applicationId)
    .eq('user_id', userId);
}
