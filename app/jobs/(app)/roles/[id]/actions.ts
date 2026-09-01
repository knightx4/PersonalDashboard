'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, requireUser } from '@/lib/jobs/auth/server';

/**
 * Notes attach to exactly one parent, enforced by a check constraint in the
 * database rather than by this code path remembering to.
 */
const noteSchema = z
  .object({
    body: z.string().trim().min(1, 'A note needs some text.'),
    companyId: z.string().uuid().optional(),
    roleId: z.string().uuid().optional(),
    applicationId: z.string().uuid().optional(),
    contactId: z.string().uuid().optional(),
    interviewId: z.string().uuid().optional(),
  })
  .refine(
    (value) =>
      [value.companyId, value.roleId, value.applicationId, value.contactId, value.interviewId].filter(
        Boolean,
      ).length === 1,
    { message: 'A note attaches to exactly one thing.' },
  );

export async function addNote(input: {
  body: string;
  companyId?: string;
  roleId?: string;
  applicationId?: string;
  contactId?: string;
  interviewId?: string;
}): Promise<{ error: string | null }> {
  const parsed = noteSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const user = await requireUser();
  const supabase = await createClient();

  const { error } = await supabase.from('notes').insert({
    user_id: user.id,
    body: parsed.data.body,
    company_id: parsed.data.companyId ?? null,
    role_id: parsed.data.roleId ?? null,
    application_id: parsed.data.applicationId ?? null,
    contact_id: parsed.data.contactId ?? null,
    interview_id: parsed.data.interviewId ?? null,
  });

  if (error) return { error: error.message };

  if (parsed.data.roleId) revalidatePath(`/jobs/roles/${parsed.data.roleId}`);
  if (parsed.data.companyId) revalidatePath('/jobs/companies');
  if (parsed.data.contactId) revalidatePath('/jobs/contacts');
  return { error: null };
}

const renameRoleSchema = z.object({
  roleId: z.string().uuid(),
  title: z.string().trim().min(1, 'A role needs a name.').max(200),
});

/**
 * The inbox's best guess at a title is still a guess, and the ones it could
 * not read at all are left as "Role from email" -- both are worth overriding
 * by hand rather than living with.
 */
export async function renameRole(roleId: string, title: string): Promise<{ error: string | null }> {
  const parsed = renameRoleSchema.safeParse({ roleId, title });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const user = await requireUser();
  const supabase = await createClient();

  const { error } = await supabase
    .from('roles')
    .update({ title: parsed.data.title })
    .eq('id', parsed.data.roleId)
    .eq('user_id', user.id);

  if (error) return { error: error.message };

  revalidatePath('/jobs/roles/[id]', 'page');
  revalidatePath('/jobs/roles');
  revalidatePath('/jobs/pipeline');
  revalidatePath('/jobs/companies/[slug]', 'page');
  revalidatePath('/jobs/today');
  return { error: null };
}

const reminderSchema = z.object({
  applicationId: z.string().uuid(),
  body: z.string().trim().min(1, 'Say what it is.'),
  dueAt: z.string().min(1, 'Pick a date.'),
});

/**
 * A to-do you set for yourself, not one the sweep raised.
 *
 * Same table and the same Nudges section on This week as the automatic
 * ones — `rule_key` stays null, which is what tells the sweep this one is
 * not its to manage, so it will not touch or re-fire it.
 */
export async function addReminder(input: {
  applicationId: string;
  body: string;
  dueAt: string;
}): Promise<{ error: string | null }> {
  const parsed = reminderSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const user = await requireUser();
  const supabase = await createClient();

  const { error } = await supabase.from('reminders').insert({
    user_id: user.id,
    application_id: parsed.data.applicationId,
    kind: 'custom',
    body: parsed.data.body,
    due_at: new Date(parsed.data.dueAt).toISOString(),
  });

  if (error) return { error: error.message };

  revalidatePath('/jobs/roles/[id]', 'page');
  revalidatePath('/jobs/today');
  return { error: null };
}

export async function saveInterview(
  interviewId: string,
  patch: {
    prepNotes?: string;
    debrief?: string;
    wentWell?: string;
    wentPoorly?: string;
    status?: 'scheduled' | 'completed' | 'cancelled' | 'rescheduled';
  },
): Promise<{ error: string | null }> {
  const user = await requireUser();
  const supabase = await createClient();

  const update: Record<string, unknown> = {};
  if (patch.prepNotes !== undefined) update.prep_notes = patch.prepNotes || null;
  if (patch.debrief !== undefined) update.debrief = patch.debrief || null;
  if (patch.wentWell !== undefined) update.went_well = patch.wentWell || null;
  if (patch.wentPoorly !== undefined) update.went_poorly = patch.wentPoorly || null;
  if (patch.status !== undefined) update.status = patch.status;

  const { error } = await supabase
    .from('interviews')
    .update(update)
    .eq('id', interviewId)
    .eq('user_id', user.id);

  if (error) return { error: error.message };
  revalidatePath('/jobs/interviews');
  return { error: null };
}
