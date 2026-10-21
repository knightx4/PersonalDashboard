import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';

/**
 * Contacts and the outreach log, as the contacts pages and Dash's
 * change_contact, change_touch and mark_suggestion_sent write them (plan
 * #2473.2). Each returns the row as written, so Dash can keep what it changed
 * for its Undo.
 *
 * Contacts hold other people's data. There is nowhere here for a personal
 * phone number or a home address: name, title, a public professional link,
 * a work email.
 */

type Row = Record<string, unknown>;
type Written = { row: Row | null; error: string | null };

export const CONTACT_RELATIONSHIPS = ['cold', 'alum', 'second_degree', 'former_colleague', 'friend', 'recruiter', 'interviewer'] as const;
export const TOUCH_CHANNELS = ['linkedin_dm', 'linkedin_connect', 'email', 'intro', 'event', 'other'] as const;
export type TouchChannel = (typeof TOUCH_CHANNELS)[number];

/** The statuses a send moves on to contacted. */
export const BEFORE_CONTACTED = ['to_contact', 'connected'] as const;

async function one(query: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<Written> {
  const { data, error } = await query;
  if (error) return { row: null, error: error.message };
  return { row: (data as Row | null) ?? null, error: null };
}

/** What the Add contact form leaves empty: no company or details, a cold relationship, no marks. */
const NEW_CONTACT: Row = {
  company_id: null,
  title: null,
  linkedin_url: null,
  email: null,
  relationship: 'cold',
  how_we_connect: null,
  notes: null,
  potential_lead: false,
  found_by_dash: false,
};

/** Add a contact, with what `values` leaves out as the form leaves it. */
export function addContact(supabase: AppSupabaseClient, userId: string, values: Row): Promise<Written> {
  return one(supabase.from('contacts').insert({ ...NEW_CONTACT, ...values, user_id: userId }).select('*').maybeSingle());
}

/** Change one of the person's contacts. */
export function saveContactEdit(supabase: AppSupabaseClient, userId: string, contactId: string, update: Row): Promise<Written> {
  return one(supabase.from('contacts').update(update).eq('id', contactId).eq('user_id', userId).select('*').maybeSingle());
}

/**
 * A send moves the contact along to contacted, from `from` only, since a
 * contact who has replied or met them is further on already. Null when the
 * contact was not in one of those.
 */
export function markContacted(
  supabase: AppSupabaseClient,
  userId: string,
  contactId: string,
  from: readonly string[] = BEFORE_CONTACTED,
): Promise<Written> {
  return one(
    supabase
      .from('contacts')
      .update({ status: 'contacted' })
      .eq('id', contactId)
      .eq('user_id', userId)
      .in('status', [...from])
      .select('*')
      .maybeSingle(),
  );
}

/**
 * The statuses a suggested message, once sent, moves on to contacted: a
 * dormant contact Dash suggested writing to again is woken too.
 */
export const BEFORE_CONTACTED_AGAIN = ['to_contact', 'connected', 'dormant'] as const;

/** The contact a suggested person becomes once they are messaged: cold, contacted, and where Dash found them. */
export function suggestedContact(suggestion: Row, companyId: string | null): Row {
  const source = typeof suggestion.source_url === 'string' ? suggestion.source_url : null;
  return {
    company_id: companyId,
    full_name: String(suggestion.person_name).trim(),
    title: (suggestion.person_title as string | null) ?? null,
    linkedin_url: source && /linkedin\.com\/in\//.test(source) ? source : null,
    relationship: 'cold',
    status: 'contacted',
    notes: source ? `Found by Dash: ${source}` : 'Found by Dash.',
  };
}

/** Log a touch, sent now. A draft is stored but counts as no send. */
export function addTouch(
  supabase: AppSupabaseClient,
  userId: string,
  touch: {
    contact_id: string;
    application_id?: string | null;
    channel: string;
    direction: 'outbound' | 'inbound';
    message: string | null;
    draft?: boolean;
  },
): Promise<Written> {
  return one(
    supabase
      .from('contact_touches')
      .insert({
        user_id: userId,
        contact_id: touch.contact_id,
        application_id: touch.application_id ?? null,
        channel: touch.channel,
        direction: touch.direction,
        message: touch.message,
        sent_at: new Date().toISOString(),
        draft: touch.draft === true,
      })
      .select('*')
      .maybeSingle(),
  );
}

/** Correct a touch's channel or words. */
export function saveTouchEdit(
  supabase: AppSupabaseClient,
  userId: string,
  touchId: string,
  update: { channel?: string; message?: string | null },
): Promise<Written> {
  return one(supabase.from('contact_touches').update(update).eq('id', touchId).eq('user_id', userId).select('*').maybeSingle());
}

/** Mark a draft sent: it takes now as its sent time. Null when it is not a draft of theirs. */
export function markDraftSent(supabase: AppSupabaseClient, userId: string, touchId: string): Promise<Written> {
  return one(
    supabase
      .from('contact_touches')
      .update({ sent_at: new Date().toISOString(), draft: false })
      .eq('id', touchId)
      .eq('user_id', userId)
      .eq('draft', true)
      .select('*')
      .maybeSingle(),
  );
}

/** Mark a sent touch answered. Null when it is a draft, which nothing can have answered. */
export function answerTouch(supabase: AppSupabaseClient, userId: string, touchId: string, summary: string | null): Promise<Written> {
  return one(
    supabase
      .from('contact_touches')
      .update({ responded_at: new Date().toISOString(), response_summary: summary || null })
      .eq('id', touchId)
      .eq('user_id', userId)
      .eq('draft', false)
      .select('*')
      .maybeSingle(),
  );
}
