'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, requireUser } from '@/lib/jobs/auth/server';

/**
 * The escape hatch for mail Indeed's hardcoded exclusion does not cover.
 *
 * LinkedIn cannot be excluded outright the way Indeed is -- real recruiter
 * InMail and "5 jobs for you" come from the same domain -- and no amount of
 * hardcoding anticipates every board and newsletter one mailbox collects.
 * This is a domain the user says is noise, checked the same way as the
 * built-in list at classification time.
 */
const domainSchema = z
  .string()
  .trim()
  .toLowerCase()
  // Accepts a bare domain or a full address and keeps the part after the @.
  .transform((value) => value.replace(/^.*@/, ''))
  .pipe(
    z
      .string()
      .min(3, 'That does not look like a domain.')
      .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/, 'That does not look like a domain.'),
  );

// latency: pending
export async function addExcludedSender(
  _prev: { error?: string; message?: string },
  formData: FormData,
): Promise<{ error?: string; message?: string }> {
  const parsed = domainSchema.safeParse(formData.get('domain'));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const user = await requireUser();
  const supabase = await createClient();

  const { error } = await supabase
    .from('excluded_senders')
    .insert({ user_id: user.id, domain: parsed.data });

  if (error) {
    return {
      error: /excluded_senders_user_domain_uidx/.test(error.message)
        ? 'Already on the list.'
        : error.message,
    };
  }

  revalidatePath('/jobs/settings');
  return { message: `Mail from ${parsed.data} will no longer become a lead or a pursuit.` };
}

// latency: pending
export async function removeExcludedSender(id: string): Promise<{ error: string | null }> {
  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) return { error: 'That is not an exclusion.' };

  const user = await requireUser();
  const supabase = await createClient();

  const { error } = await supabase
    .from('excluded_senders')
    .delete()
    .eq('id', parsed.data)
    .eq('user_id', user.id);

  if (error) return { error: error.message };
  revalidatePath('/jobs/settings');
  return { error: null };
}
