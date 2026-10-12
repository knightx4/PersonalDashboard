'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, requireUser } from '@/lib/jobs/auth/server';

const reminderPatchSchema = z.object({
  reminderId: z.string().uuid(),
  body: z.string().trim().min(1, 'Say what it is.'),
  dueAt: z.string().min(1, 'Pick a date.'),
});

/**
 * Rename a to-do, or move it.
 *
 * The wording of one is a first guess written while reading the mail that
 * prompted it, and the date is usually a guess too. Until now the only way to
 * correct either was to finish the to-do and write a new one, which loses the
 * mail it was linked to.
 *
 * The sweep's own reminders are edited here as freely as hand-written ones:
 * `rule_key` is what stops it re-firing, and it is not touched.
 */
// latency: pending
export async function updateReminder(input: {
  reminderId: string;
  body: string;
  dueAt: string;
}): Promise<{ error: string | null }> {
  const parsed = reminderPatchSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const user = await requireUser();
  const supabase = await createClient();

  const { error } = await supabase
    .from('reminders')
    .update({
      body: parsed.data.body,
      due_at: new Date(parsed.data.dueAt).toISOString(),
    })
    .eq('id', parsed.data.reminderId)
    .eq('user_id', user.id);

  if (error) return { error: error.message };

  revalidatePath('/jobs/roles/[id]', 'page');
  revalidatePath('/jobs');
  revalidatePath('/jobs/companies/[slug]', 'page');
  return { error: null };
}

const reminderMessageSchema = z.object({
  reminderId: z.string().uuid(),
  /** Null unlinks: the to-do stands on its own again. */
  messageId: z.string().uuid().nullable(),
});

/**
 * Point a to-do at the email that asked for it.
 *
 * "Submit the take-home" and the mail that sent the take-home are one thing
 * seen twice, and they lived in two tabs with nothing joining them. Linking
 * them is a second step rather than part of adding a to-do, because the mail
 * usually arrives first and the to-do is written from it -- and because the
 * one you want is often not the one you were looking at.
 */
// latency: pending
export async function linkReminderMessage(input: {
  reminderId: string;
  messageId: string | null;
}): Promise<{ error: string | null }> {
  const parsed = reminderMessageSchema.safeParse(input);
  if (!parsed.success) return { error: 'That is not an email to link.' };

  const user = await requireUser();
  const supabase = await createClient();

  // RLS already scopes both rows to the owner; the message check is here so a
  // stale picker says so instead of writing a link to nothing.
  if (parsed.data.messageId) {
    const { data: message } = await supabase
      .from('inbox_messages')
      .select('id')
      .eq('id', parsed.data.messageId)
      .eq('user_id', user.id)
      .maybeSingle();
    if (!message) return { error: 'That email is no longer linked to this role.' };
  }

  const { error } = await supabase
    .from('reminders')
    .update({ ingested_message_id: parsed.data.messageId })
    .eq('id', parsed.data.reminderId)
    .eq('user_id', user.id);

  if (error) return { error: error.message };

  revalidatePath('/jobs/roles/[id]', 'page');
  revalidatePath('/jobs');
  return { error: null };
}
