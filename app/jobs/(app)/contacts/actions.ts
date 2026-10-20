'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient, requireUser } from '@/lib/jobs/auth/server';
import { draftOutreach, type OutreachDraft } from '@/lib/jobs/contacts/draft-outreach';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { recordSessionSpend } from '@/lib/core/spend/session';

/**
 * Contacts hold other people's data.
 *
 * The schema deliberately has nowhere to put a personal phone number or a
 * home address, and this action deliberately has no field for one. Name,
 * title, public professional URL, work email. Nothing scraped, ever.
 */
const contactSchema = z.object({
  fullName: z.string().trim().min(1, 'A name is needed.'),
  title: z.string().trim().optional(),
  companyId: z.string().uuid().optional().or(z.literal('')),
  linkedinUrl: z.string().trim().url().optional().or(z.literal('')),
  email: z.string().trim().email().optional().or(z.literal('')),
  relationship: z
    .enum(['cold', 'alum', 'second_degree', 'former_colleague', 'friend', 'recruiter', 'interviewer'])
    .default('cold'),
  howWeConnect: z.string().trim().optional(),
  notes: z.string().trim().optional(),
  potentialLead: z.boolean().default(false),
  foundByDash: z.boolean().default(false),
});

// latency: pending
export async function createContact(
  _prev: { error?: string; message?: string },
  formData: FormData,
): Promise<{ error?: string; message?: string }> {
  const parsed = contactSchema.safeParse({
    fullName: formData.get('fullName'),
    title: formData.get('title') ?? '',
    companyId: formData.get('companyId') ?? '',
    linkedinUrl: formData.get('linkedinUrl') ?? '',
    email: formData.get('email') ?? '',
    relationship: formData.get('relationship') ?? 'cold',
    howWeConnect: formData.get('howWeConnect') ?? '',
    notes: formData.get('notes') ?? '',
    potentialLead: formData.get('potentialLead') === 'on',
    foundByDash: formData.get('foundByDash') === 'on',
  });

  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const user = await requireUser();
  const supabase = await createClient();

  const { error } = await supabase.from('contacts').insert({
    user_id: user.id,
    company_id: parsed.data.companyId || null,
    full_name: parsed.data.fullName,
    title: parsed.data.title || null,
    linkedin_url: parsed.data.linkedinUrl || null,
    email: parsed.data.email || null,
    relationship: parsed.data.relationship,
    how_we_connect: parsed.data.howWeConnect || null,
    notes: parsed.data.notes || null,
    potential_lead: parsed.data.potentialLead,
    found_by_dash: parsed.data.foundByDash,
  });

  if (error) return { error: error.message };
  revalidatePath('/jobs/contacts');
  // Added from a company's People card (note 4323ee10), so it lists there too.
  if (parsed.data.companyId) revalidatePath('/jobs/companies/[slug]', 'page');
  return { message: 'Added.' };
}

const RELATIONSHIPS = ['cold', 'alum', 'second_degree', 'former_colleague', 'friend', 'recruiter', 'interviewer'] as const;
const STATUSES = ['to_contact', 'connected', 'contacted', 'responded', 'met', 'dormant'] as const;

const contactPatchSchema = z
  .object({
    fullName: z.string().trim().min(1, 'A name is needed.'),
    title: z.string().trim(),
    linkedinUrl: z.string().trim().url('That is not a link.').or(z.literal('')),
    email: z.string().trim().email('That is not an email address.').or(z.literal('')),
    howWeConnect: z.string().trim(),
    notes: z.string().trim(),
    relationship: z.enum(RELATIONSHIPS),
    status: z.enum(STATUSES),
    potentialLead: z.boolean(),
    foundByDash: z.boolean(),
  })
  .partial();

export type ContactPatch = z.input<typeof contactPatchSchema>;

const COLUMNS: Record<keyof ContactPatch, string> = {
  fullName: 'full_name',
  title: 'title',
  linkedinUrl: 'linkedin_url',
  email: 'email',
  howWeConnect: 'how_we_connect',
  notes: 'notes',
  relationship: 'relationship',
  status: 'status',
  potentialLead: 'potential_lead',
  foundByDash: 'found_by_dash',
};

/**
 * Change one or more of a contact's details where the page shows them. A
 * contact created from mail arrives with only a name, so title, LinkedIn and
 * how you actually know them are filled in here, one value at a time; an
 * empty text clears the value.
 */
// latency: optimistic -- each value shows its new text at once
export async function updateContact(
  contactId: string,
  patch: ContactPatch,
): Promise<{ error: string | null }> {
  const parsed = contactPatchSchema.safeParse(patch);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const update: Record<string, string | boolean | null> = {};
  for (const [key, value] of Object.entries(parsed.data)) {
    if (value === undefined) continue;
    update[COLUMNS[key as keyof ContactPatch]] = value === '' ? null : value;
  }
  if (Object.keys(update).length === 0) return { error: null };

  const user = await requireUser();
  const supabase = await createClient();

  const { error } = await supabase
    .from('contacts')
    .update(update)
    .eq('id', contactId)
    .eq('user_id', user.id);

  if (error) return { error: error.message };
  revalidatePath('/jobs/contacts');
  revalidatePath('/jobs/contacts/[id]', 'page');
  revalidatePath('/jobs/companies/[slug]', 'page');
  return { error: null };
}

/**
 * Delete a contact (note 8902b443). Their logged sends, notes, reminders and
 * interview places go with them, by the foreign keys; a referral on an
 * application keeps the application and loses the name. The page asks first,
 * and goes back to the list once it is gone.
 */
// latency: pending
export async function deleteContact(contactId: string): Promise<{ error: string | null }> {
  const parsed = z.string().uuid().safeParse(contactId);
  if (!parsed.success) return { error: 'That is not a contact.' };

  const user = await requireUser();
  const supabase = await createClient();

  const { error } = await supabase.from('contacts').delete().eq('id', parsed.data).eq('user_id', user.id);

  if (error) return { error: error.message };
  revalidatePath('/jobs/contacts');
  revalidatePath('/jobs/companies/[slug]', 'page');
  redirect('/jobs/contacts');
}

const DraftRequest = z.object({
  contactId: z.string().uuid(),
  channel: z.enum(['linkedin_dm', 'linkedin_connect', 'email', 'intro', 'event', 'other']),
  aim: z.string().max(1_000).default(''),
});

/**
 * Draft a message to this contact (lib/jobs/contacts/draft-outreach.ts).
 * Nothing is kept: the draft comes back to the page, and becomes a send in
 * the log only when it is logged as sent.
 */
// latency: pending -- a model call; the button says it is working
export async function draftContactMessage(input: {
  contactId: string;
  channel: string;
  aim?: string;
}): Promise<{ error: string | null; draft?: OutreachDraft }> {
  const parsed = DraftRequest.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { error: 'Drafting is not configured.' };

  const user = await requireUser();
  const supabase = await createClient();
  const spend: SpendReport[] = [];
  const result = await draftOutreach(supabase, user.id, parsed.data, {
    apiKey,
    onSpend: (report) => spend.push(report),
  });
  await recordSessionSpend(user.id, { module: 'jobs', operation: 'draft-outreach' }, spend);
  return result.ok ? { error: null, draft: result.draft } : { error: result.error };
}

const CHANNELS = ['linkedin_dm', 'linkedin_connect', 'email', 'intro', 'event', 'other'] as const;
type Channel = (typeof CHANNELS)[number];

/** A send as the contact page lists it. */
export interface LoggedTouch {
  id: string;
  channel: string;
  direction: string;
  sentAt: string;
  respondedAt: string | null;
  message: string | null;
}

// latency: pending
export async function logTouch(input: {
  contactId: string;
  channel: Channel;
  direction: 'outbound' | 'inbound';
  message?: string;
  applicationId?: string;
}): Promise<{ error: string | null; touch?: LoggedTouch }> {
  const user = await requireUser();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('contact_touches')
    .insert({
      user_id: user.id,
      contact_id: input.contactId,
      application_id: input.applicationId ?? null,
      channel: input.channel,
      direction: input.direction,
      message: input.message?.trim() || null,
      sent_at: new Date().toISOString(),
    })
    .select('id, channel, direction, sent_at, responded_at, message')
    .single();

  if (error) return { error: error.message };

  // A send moves the contact along; the status is what the list view sorts by.
  if (input.direction === 'outbound') {
    await supabase
      .from('contacts')
      .update({ status: 'contacted' })
      .eq('id', input.contactId)
      .eq('user_id', user.id)
      .in('status', ['to_contact', 'connected']);
  }

  revalidatePath('/jobs/contacts');
  revalidatePath('/jobs/contacts/[id]', 'page');
  return {
    error: null,
    touch: {
      id: data.id as string,
      channel: data.channel as string,
      direction: data.direction as string,
      sentAt: data.sent_at as string,
      respondedAt: (data.responded_at as string | null) ?? null,
      message: (data.message as string | null) ?? null,
    },
  };
}

/**
 * Change how a send went out, or what it said, on the send itself. A send is
 * logged first and described after, so both are edited where the log shows
 * them.
 */
// latency: optimistic -- the chip and the line show the new value at once
export async function updateTouch(
  touchId: string,
  patch: { channel?: Channel; message?: string },
): Promise<{ error: string | null }> {
  const user = await requireUser();
  const supabase = await createClient();

  const update: { channel?: Channel; message?: string | null } = {};
  if (patch.channel !== undefined) {
    if (!CHANNELS.includes(patch.channel)) return { error: 'Not a channel this log knows.' };
    update.channel = patch.channel;
  }
  if (patch.message !== undefined) update.message = patch.message.trim() || null;
  if (Object.keys(update).length === 0) return { error: null };

  const { error } = await supabase
    .from('contact_touches')
    .update(update)
    .eq('id', touchId)
    .eq('user_id', user.id);

  if (error) return { error: error.message };
  revalidatePath('/jobs/contacts/[id]', 'page');
  return { error: null };
}

// latency: pending
export async function markTouchAnswered(
  touchId: string,
  summary: string,
): Promise<{ error: string | null }> {
  const user = await requireUser();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('contact_touches')
    .update({ responded_at: new Date().toISOString(), response_summary: summary || null })
    .eq('id', touchId)
    .eq('user_id', user.id)
    .select('contact_id')
    .single();

  if (error) return { error: error.message };

  await supabase
    .from('contacts')
    .update({ status: 'responded' })
    .eq('id', data.contact_id)
    .eq('user_id', user.id);

  revalidatePath('/jobs/contacts');
  revalidatePath('/jobs/contacts/[id]', 'page');
  return { error: null };
}

/**
 * Take a send out of the log, one logged by mistake (note 0e5c4181). The row
 * asks first. The contact's status is left as it is, since a status set by
 * hand often stands for sends made outside the app.
 */
// latency: optimistic -- the line leaves the log at once
export async function deleteTouch(touchId: string): Promise<{ error: string | null }> {
  const parsed = z.string().uuid().safeParse(touchId);
  if (!parsed.success) return { error: 'That is not a send.' };

  const user = await requireUser();
  const supabase = await createClient();

  const { error } = await supabase
    .from('contact_touches')
    .delete()
    .eq('id', parsed.data)
    .eq('user_id', user.id);

  if (error) return { error: error.message };
  revalidatePath('/jobs/contacts');
  revalidatePath('/jobs/contacts/[id]', 'page');
  return { error: null };
}
