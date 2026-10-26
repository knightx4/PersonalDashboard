/**
 * The person names who an application is followed up with themselves, as
 * many people as they want: a contact already on file, or someone new they
 * type in, who becomes a contact at the role's company. Free, and it writes
 * no note; the Outreach tab offers Dash's draft or a blank one after.
 *
 * Taking someone off the list takes away their unsent note about this
 * application too. Sent notes stay in the log.
 */
import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import { addContact, addTouch } from '@/lib/jobs/contacts/edit';
import { channelFor } from './person';

export type ChosenPerson =
  | { contactId: string }
  | { name: string; title?: string | null; linkedinUrl?: string | null; email?: string | null };

export const CHOSEN_WHY = 'You chose them.';

export async function addFollowUpPerson(
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
    .from('application_outreach')
    .upsert(
      { user_id: userId, application_id: applicationId, contact_id: contactId, why: CHOSEN_WHY, chosen_by: 'person' },
      { onConflict: 'application_id,contact_id' },
    );
  if (error) return { error: error.message };
  return { error: null, contactId };
}

/** Take someone off the application's list, with their unsent note about it. */
export async function removeFollowUpPerson(
  supabase: AppSupabaseClient,
  userId: string,
  applicationId: string,
  contactId: string,
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('application_outreach')
    .delete()
    .eq('user_id', userId)
    .eq('application_id', applicationId)
    .eq('contact_id', contactId);
  if (error) return { error: error.message };
  await supabase
    .from('contact_touches')
    .delete()
    .eq('user_id', userId)
    .eq('application_id', applicationId)
    .eq('contact_id', contactId)
    .eq('draft', true);
  return { error: null };
}

/** A blank note to one person on the list, for writing it without Dash. */
export async function startOwnNote(
  supabase: AppSupabaseClient,
  userId: string,
  applicationId: string,
  contactId: string,
): Promise<{ error: string | null }> {
  const { data: named } = await supabase
    .from('application_outreach')
    .select('contacts ( email, relationship, status, linkedin_connection )')
    .eq('user_id', userId)
    .eq('application_id', applicationId)
    .eq('contact_id', contactId)
    .maybeSingle();
  const c = (named as unknown as {
    contacts: { email: string | null; relationship: string; status: string; linkedin_connection: boolean } | null;
  } | null)?.contacts;
  if (!c) return { error: 'They are not on this application’s list.' };
  const { error } = await addTouch(supabase, userId, {
    contact_id: contactId,
    application_id: applicationId,
    channel: channelFor({ email: c.email, relationship: c.relationship, status: c.status, linkedinConnection: c.linkedin_connection }),
    direction: 'outbound',
    message: '',
    draft: true,
  });
  return { error };
}
