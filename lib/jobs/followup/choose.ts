/**
 * The person names who an application is followed up with themselves: a
 * contact already on file, or someone new they type in, who becomes a
 * contact at the role's company. Free, and it writes no note; the card
 * offers Dash's draft or a blank one after.
 *
 * A note not yet sent to the person named before is taken away, since it
 * was written to them by name. Sent notes stay in the log.
 */
import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import { addContact, addTouch } from '@/lib/jobs/contacts/edit';
import { channelFor } from './person';

export type ChosenPerson =
  | { contactId: string }
  | { name: string; title?: string | null; linkedinUrl?: string | null; email?: string | null };

export const CHOSEN_WHY = 'You chose them.';

export async function chooseFollowUpPerson(
  supabase: AppSupabaseClient,
  userId: string,
  applicationId: string,
  who: ChosenPerson,
): Promise<{ error: string | null; contactId?: string }> {
  const { data: app } = await supabase
    .from('applications')
    .select('id, roles!inner ( company_id )')
    .eq('id', applicationId)
    .eq('user_id', userId)
    .maybeSingle();
  if (!app) return { error: 'That application is not on file.' };
  const companyId = (app as unknown as { roles: { company_id: string } }).roles.company_id;

  let contactId: string;
  if ('contactId' in who) {
    const { data: contact } = await supabase.from('contacts').select('id').eq('id', who.contactId).eq('user_id', userId).maybeSingle();
    if (!contact) return { error: 'That contact is not on file.' };
    contactId = who.contactId;
  } else {
    const { row, error } = await addContact(supabase, userId, {
      company_id: companyId,
      full_name: who.name.trim(),
      title: who.title?.trim() || null,
      linkedin_url: who.linkedinUrl?.trim() || null,
      email: who.email?.trim() || null,
    });
    if (error || !row) return { error: error ?? 'The contact was not kept.' };
    contactId = row.id as string;
  }

  const { error } = await supabase
    .from('applications')
    .update({ follow_up_contact_id: contactId, follow_up_why: CHOSEN_WHY, follow_up_tried_at: new Date().toISOString() })
    .eq('id', applicationId)
    .eq('user_id', userId);
  if (error) return { error: error.message };

  await supabase
    .from('contact_touches')
    .delete()
    .eq('user_id', userId)
    .eq('application_id', applicationId)
    .eq('draft', true)
    .neq('contact_id', contactId);
  return { error: null, contactId };
}

/** A blank note to the person named, for writing it without Dash. */
export async function startOwnNote(
  supabase: AppSupabaseClient,
  userId: string,
  applicationId: string,
): Promise<{ error: string | null }> {
  const { data: app } = await supabase
    .from('applications')
    .select('follow_up_contact_id, contacts!applications_follow_up_contact_id_fkey ( email, relationship, status, linkedin_connection )')
    .eq('id', applicationId)
    .eq('user_id', userId)
    .maybeSingle();
  const row = app as unknown as {
    follow_up_contact_id: string | null;
    contacts: { email: string | null; relationship: string; status: string; linkedin_connection: boolean } | null;
  } | null;
  if (!row?.follow_up_contact_id || !row.contacts) return { error: 'Nobody is named for this application yet.' };
  const c = row.contacts;
  const { error } = await addTouch(supabase, userId, {
    contact_id: row.follow_up_contact_id,
    application_id: applicationId,
    channel: channelFor({ email: c.email, relationship: c.relationship, status: c.status, linkedinConnection: c.linkedin_connection }),
    direction: 'outbound',
    message: '',
    draft: true,
  });
  return { error };
}
