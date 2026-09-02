'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, requireUser } from '@/lib/jobs/auth/server';

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
});

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
  });

  if (error) return { error: error.message };
  revalidatePath('/jobs/contacts');
  return { message: 'Added.' };
}

const contactEditSchema = z.object({
  fullName: z.string().trim().min(1, 'A name is needed.'),
  title: z.string().trim().optional(),
  linkedinUrl: z.string().trim().url().optional().or(z.literal('')),
  email: z.string().trim().email().optional().or(z.literal('')),
  howWeConnect: z.string().trim().optional(),
  notes: z.string().trim().optional(),
});

/**
 * Fill in what a contact created from mail never had: a name is all the
 * inbox can give you, so title, LinkedIn and how you actually know them stay
 * blank until you add them by hand.
 */
export async function updateContact(
  contactId: string,
  input: {
    fullName: string;
    title: string;
    linkedinUrl: string;
    email: string;
    howWeConnect: string;
    notes: string;
  },
): Promise<{ error: string | null }> {
  const parsed = contactEditSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const user = await requireUser();
  const supabase = await createClient();

  const { error } = await supabase
    .from('contacts')
    .update({
      full_name: parsed.data.fullName,
      title: parsed.data.title || null,
      linkedin_url: parsed.data.linkedinUrl || null,
      email: parsed.data.email || null,
      how_we_connect: parsed.data.howWeConnect || null,
      notes: parsed.data.notes || null,
    })
    .eq('id', contactId)
    .eq('user_id', user.id);

  if (error) return { error: error.message };
  revalidatePath('/jobs/contacts');
  revalidatePath('/jobs/contacts/[id]', 'page');
  revalidatePath('/jobs/companies/[slug]', 'page');
  return { error: null };
}

export async function logTouch(input: {
  contactId: string;
  channel: 'linkedin_dm' | 'linkedin_connect' | 'email' | 'intro' | 'event' | 'other';
  direction: 'outbound' | 'inbound';
  message?: string;
  applicationId?: string;
}): Promise<{ error: string | null }> {
  const user = await requireUser();
  const supabase = await createClient();

  const { error } = await supabase.from('contact_touches').insert({
    user_id: user.id,
    contact_id: input.contactId,
    application_id: input.applicationId ?? null,
    channel: input.channel,
    direction: input.direction,
    message: input.message?.trim() || null,
    sent_at: new Date().toISOString(),
  });

  if (error) return { error: error.message };

  // A send moves the contact along; the status is what the list view sorts by.
  if (input.direction === 'outbound') {
    await supabase
      .from('contacts')
      .update({ status: 'contacted' })
      .eq('id', input.contactId)
      .eq('user_id', user.id)
      .eq('status', 'to_contact');
  }

  revalidatePath('/jobs/contacts');
  revalidatePath('/jobs/contacts/[id]', 'page');
  return { error: null };
}

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
