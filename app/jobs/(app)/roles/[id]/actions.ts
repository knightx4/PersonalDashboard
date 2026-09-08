'use server';

import { randomBytes } from 'crypto';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, requireUser } from '@/lib/jobs/auth/server';
import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import { linkMessage } from '@/app/jobs/(app)/review/actions';
import { ensureCompany } from '@/lib/jobs/companies/ensure';
import { findUnlinkedMessages, type UnlinkedMessage } from '@/lib/jobs/inbox/link-candidates';
import { INTERVIEW_KINDS } from '@/lib/jobs/interview-kinds';
import type { Requirement } from '@/lib/jobs/jd/requirements';
import { matchRequirements } from '@/lib/jobs/evidence/match';
import { matchKey, type RequirementMatch } from '@/lib/jobs/evidence/match-payload';
import { shortlistEvidence } from '@/lib/jobs/evidence/shortlist';

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

  // A note on a round is read on the role page, which is two joins away from
  // the id the note carries. Worth one lookup: without it the note is written
  // and the page it was written on does not show it.
  if (parsed.data.interviewId) {
    const { data: interview } = await supabase
      .from('interviews')
      .select('applications!inner ( role_id )')
      .eq('id', parsed.data.interviewId)
      .eq('user_id', user.id)
      .maybeSingle<{ applications: { role_id: string } }>();
    if (interview) revalidatePath(`/jobs/roles/${interview.applications.role_id}`);
  }

  return { error: null };
}

/**
 * Rewrite a note.
 *
 * The role is passed in rather than looked up: the caller is the page the note
 * is being written on, it already knows which role it is, and a note that is
 * saved but does not reappear until a hard reload is a note you write twice.
 */
export async function updateNote(input: {
  noteId: string;
  roleId: string;
  body: string;
}): Promise<{ error: string | null }> {
  const parsed = z
    .object({
      noteId: z.string().uuid(),
      roleId: z.string().uuid(),
      body: z.string().trim().min(1, 'A note needs some text.').max(50_000),
    })
    .safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const user = await requireUser();
  const supabase = await createClient();

  const { error } = await supabase
    .from('notes')
    .update({ body: parsed.data.body })
    .eq('id', parsed.data.noteId)
    .eq('user_id', user.id);
  if (error) return { error: error.message };

  revalidatePath(`/jobs/roles/${parsed.data.roleId}`);
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

const moveRoleSchema = z.object({
  roleId: z.string().uuid(),
  companyName: z.string().trim().min(1, 'Which company is this?').max(200),
});

/**
 * Put a role under the company it actually belongs to.
 *
 * The linker attributes mail by sender domain, and a shared ATS domain or a
 * forwarded thread lands a pursuit under the wrong name often enough that
 * "delete it and start again" was the only remedy — which throws away the
 * timeline and every linked message with it. Moving the role keeps all of it.
 *
 * The company is resolved by name the same way creating a role resolves it, so
 * a company that is not on file yet is created rather than blocking the move.
 */
export async function moveRoleToCompany(
  roleId: string,
  companyName: string,
): Promise<{ error: string | null; slug: string | null }> {
  const parsed = moveRoleSchema.safeParse({ roleId, companyName });
  if (!parsed.success) return { error: parsed.error.issues[0].message, slug: null };

  const user = await requireUser();
  const supabase = await createClient();

  const company = await ensureCompany(supabase, user.id, parsed.data.companyName);
  if (company.error) return { error: company.error, slug: null };

  const { error } = await supabase
    .from('roles')
    .update({ company_id: company.id })
    .eq('id', parsed.data.roleId)
    .eq('user_id', user.id);

  if (error) {
    // (user_id, company_id, jd_hash) is unique: the same posting is already
    // filed under the company being moved to.
    return {
      error:
        error.code === '23505'
          ? 'That company already has this same posting. Merge the two from the company page instead.'
          : error.message,
      slug: null,
    };
  }

  const { data: moved } = await supabase
    .from('companies')
    .select('slug')
    .eq('id', company.id)
    .maybeSingle();

  revalidatePath('/jobs/roles/[id]', 'page');
  revalidatePath('/jobs/roles');
  revalidatePath('/jobs/pipeline');
  revalidatePath('/jobs/companies');
  revalidatePath('/jobs/companies/[slug]', 'page');
  revalidatePath('/jobs/today');
  return { error: null, slug: (moved?.slug as string) ?? null };
}

const unlinkSchema = z.object({
  messageId: z.string().uuid(),
  applicationId: z.string().uuid(),
});

/**
 * "This email is not about this pursuit."
 *
 * The message goes back to the review queue rather than being thrown away, and
 * every event it wrote here goes with it — leaving those behind would keep the
 * status derived from mail this role no longer claims. The pair is remembered
 * as declined so the same suggestion does not immediately offer itself again.
 */
export async function unlinkMessage(
  messageId: string,
  applicationId: string,
): Promise<{ error: string | null }> {
  const parsed = unlinkSchema.safeParse({ messageId, applicationId });
  if (!parsed.success) return { error: 'That is not an unlinkable pair.' };

  const user = await requireUser();
  const supabase = await createClient();

  const { data: message } = await supabase
    .from('inbox_messages')
    .select('id, user_id')
    .eq('id', parsed.data.messageId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!message) return { error: 'That message is no longer in the mailbox.' };

  // Events first: while the message still points at the application, a failure
  // here leaves the link intact rather than a pursuit whose timeline has
  // quietly lost its evidence.
  const { error: eventsError } = await supabase
    .from('application_events')
    .delete()
    .eq('ingested_message_id', parsed.data.messageId)
    .eq('application_id', parsed.data.applicationId)
    .eq('user_id', user.id);

  if (eventsError) return { error: eventsError.message };

  const { error } = await supabase
    .from('ingested_messages')
    .update({
      resulting_application_id: null,
      parse_status: 'needs_review',
      link_method: null,
      link_confidence: null,
      error: 'Unlinked by hand from the role page.',
    })
    .eq('id', parsed.data.messageId);

  if (error) return { error: error.message };

  await supabase.from('message_link_dismissals').upsert(
    {
      user_id: user.id,
      application_id: parsed.data.applicationId,
      message_id: parsed.data.messageId,
    },
    { onConflict: 'application_id,message_id' },
  );

  revalidatePath('/jobs/roles/[id]', 'page');
  revalidatePath('/jobs/review');
  revalidatePath('/jobs/pipeline');
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
  // And on the company, which rolls up the to-dos of every role it has.
  revalidatePath('/jobs/companies/[slug]', 'page');
  return { error: null };
}

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
  revalidatePath('/jobs/today');
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
  revalidatePath('/jobs/today');
  return { error: null };
}

/**
 * When a round is, in the three states it can actually be in: an hour, a day
 * whose hour is not settled, or nothing agreed yet. `timeKnown` is only
 * meaningful alongside a date, and a null date forces it false.
 */
const scheduleSchema = z
  .object({
    scheduledAt: z.string().datetime({ offset: true }).nullable(),
    timeKnown: z.boolean(),
  })
  .transform((value) => ({
    scheduledAt: value.scheduledAt,
    timeKnown: value.scheduledAt === null ? false : value.timeKnown,
  }));

const interviewPatchSchema = z.object({
  kind: z.enum(INTERVIEW_KINDS).optional(),
});

/**
 * Update one interview.
 *
 * Kind is here because it is what the card is called and the inbox guesses it:
 * a "quick chat" invite becomes a recruiter screen. The guess is usually close
 * and occasionally wrong, and a wrong name on a card the user cannot correct
 * is worse than no name — so it is editable like the notes.
 *
 * When is here for the same reason and one more: an interview can be added
 * before its date exists, so filling that in later is the only way such a one
 * ever gets a date.
 *
 * The round number is not here. It belongs to the round now, and is set
 * through `saveInterviewGroup`.
 */
export async function saveInterview(
  interviewId: string,
  patch: {
    prepNotes?: string;
    notes?: string;
    status?: 'scheduled' | 'completed' | 'cancelled' | 'rescheduled';
    kind?: string;
    scheduledAt?: string | null;
    timeKnown?: boolean;
  },
): Promise<{ error: string | null }> {
  const user = await requireUser();
  const supabase = await createClient();

  const parsed = interviewPatchSchema.safeParse({ kind: patch.kind });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const update: Record<string, unknown> = {};
  if (patch.prepNotes !== undefined) update.prep_notes = patch.prepNotes || null;
  if (patch.notes !== undefined) update.notes = patch.notes || null;
  if (patch.status !== undefined) update.status = patch.status;
  if (parsed.data.kind !== undefined) update.kind = parsed.data.kind;

  if (patch.scheduledAt !== undefined) {
    const schedule = scheduleSchema.safeParse({
      scheduledAt: patch.scheduledAt,
      timeKnown: patch.timeKnown ?? true,
    });
    if (!schedule.success) return { error: 'That is not a date.' };
    update.scheduled_at = schedule.data.scheduledAt;
    update.time_known = schedule.data.timeKnown;
  }

  const { error } = await supabase
    .from('interviews')
    .update(update)
    .eq('id', interviewId)
    .eq('user_id', user.id);

  if (error) return { error: error.message };
  revalidatePath('/jobs/interviews');
  revalidatePath('/jobs/roles/[id]', 'page');
  revalidatePath('/jobs/today');
  return { error: null };
}

const addInterviewSchema = z.object({
  applicationId: z.string().uuid(),
  kind: z.enum(INTERVIEW_KINDS),
  groupId: z.string().uuid().nullable(),
  schedule: scheduleSchema,
});

/**
 * The round an interview is going into, making one if it is going into a new
 * round.
 *
 * Every interview is inside a round now, so "add an interview on its own"
 * cannot mean an interview with no round -- it means a round with one
 * interview in it, which is the ordinary shape of a phone screen. The number
 * follows the rounds already on the pursuit.
 */
async function roundForNewInterview(
  supabase: AppSupabaseClient,
  opts: { userId: string; applicationId: string; groupId: string | null },
): Promise<{ groupId: string | null; error: string | null }> {
  if (opts.groupId) return { groupId: opts.groupId, error: null };

  const { data: rounds } = await supabase
    .from('interview_groups')
    .select('round_number')
    .eq('application_id', opts.applicationId)
    .eq('user_id', opts.userId);

  const highest = (rounds ?? []).reduce(
    (top, row) => Math.max(top, (row.round_number as number | null) ?? 0),
    0,
  );

  const { data, error } = await supabase
    .from('interview_groups')
    .insert({
      user_id: opts.userId,
      application_id: opts.applicationId,
      round_number: highest + 1,
    })
    .select('id')
    .single();

  if (error || !data) return { groupId: null, error: error?.message ?? 'Could not add the round.' };
  return { groupId: data.id as string, error: null };
}

/** The next free place inside a round, so a superday reads in order. */
async function positionInRound(
  supabase: AppSupabaseClient,
  groupId: string,
): Promise<number> {
  const { count } = await supabase
    .from('interviews')
    .select('id', { count: 'exact', head: true })
    .eq('group_id', groupId);
  return (count ?? 0) + 1;
}

/**
 * A round the inbox never saw mail about -- a phone screen nobody emailed
 * you the invite for, or the same case with `deleteInterview`: a round the
 * inbox saw twice.
 *
 * The date is optional both ways round: "they want to do an onsite, dates to
 * follow" is a real round worth putting on the board, and so is a day agreed
 * without an hour. Either can be filled in later through `saveInterview`.
 */
export async function addInterview(input: {
  applicationId: string;
  kind: string;
  /** The round it goes in. Absent means a new round of its own. */
  groupId?: string | null;
  scheduledAt: string | null;
  timeKnown: boolean;
}): Promise<{ error: string | null }> {
  const parsed = addInterviewSchema.safeParse({
    applicationId: input.applicationId,
    kind: input.kind,
    groupId: input.groupId ?? null,
    schedule: { scheduledAt: input.scheduledAt, timeKnown: input.timeKnown },
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const user = await requireUser();
  const supabase = await createClient();

  const round = await roundForNewInterview(supabase, {
    userId: user.id,
    applicationId: parsed.data.applicationId,
    groupId: parsed.data.groupId,
  });
  if (!round.groupId) return { error: round.error };

  const { error } = await supabase.from('interviews').insert({
    user_id: user.id,
    application_id: parsed.data.applicationId,
    round: await positionInRound(supabase, round.groupId),
    kind: parsed.data.kind,
    group_id: round.groupId,
    scheduled_at: parsed.data.schedule.scheduledAt,
    time_known: parsed.data.schedule.timeKnown,
  });

  if (error) return { error: error.message };
  revalidatePath('/jobs/interviews');
  revalidatePath('/jobs/roles/[id]', 'page');
  revalidatePath('/jobs/today');
  return { error: null };
}

const participantSchema = z.object({
  interviewId: z.string().uuid(),
  contactId: z.string().uuid(),
});

/**
 * Name who is in the room, as the contact rather than as a string.
 *
 * A calendar invite already records its attendees this way, and the point of
 * keeping it a contact is that the name on a round is the same record as the
 * one on the contacts page -- so it carries the title, the LinkedIn and every
 * touch, instead of being a second, unlinked copy of a person.
 */
export async function addInterviewer(input: {
  interviewId: string;
  contactId: string;
}): Promise<{ error: string | null }> {
  const parsed = participantSchema.safeParse(input);
  if (!parsed.success) return { error: 'That is not a person to add.' };

  const user = await requireUser();
  const supabase = await createClient();

  // RLS reaches the owner through the interview, and a trigger refuses a
  // contact belonging to someone else -- but a silent zero-row write explains
  // nothing, so the contact is checked here for a message worth reading.
  const { data: contact } = await supabase
    .from('contacts')
    .select('id')
    .eq('id', parsed.data.contactId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!contact) return { error: 'That contact no longer exists.' };

  const { error } = await supabase.from('interview_participants').upsert(
    {
      interview_id: parsed.data.interviewId,
      contact_id: parsed.data.contactId,
      role: 'interviewer',
    },
    { onConflict: 'interview_id,contact_id', ignoreDuplicates: true },
  );

  if (error) return { error: error.message };
  revalidatePath('/jobs/interviews');
  revalidatePath('/jobs/roles/[id]', 'page');
  return { error: null };
}

/** Wrong person, or an invite that swept in the room's calendar account. */
const newInterviewerSchema = z.object({
  interviewId: z.string().uuid(),
  name: z.string().trim().min(1, 'A name is needed.').max(120),
});

/**
 * Name someone who is not in the contact list yet, from the round itself.
 *
 * The picker could only offer people already on file, which made naming your
 * interviewer a trip to the company page and back — and the people you most
 * want to name are exactly the ones with no record yet, because an interviewer
 * has by definition never sent you anything. The invite parser has always
 * created them this way when it could read the attendees; this is the same
 * thing done by hand when it could not.
 *
 * They land on the company the pursuit is at, so the name on the round is a
 * real contact record with a page of its own rather than a loose string.
 */
export async function addInterviewerByName(input: {
  interviewId: string;
  name: string;
}): Promise<{ error: string | null }> {
  const parsed = newInterviewerSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const user = await requireUser();
  const supabase = await createClient();

  const { data: interview } = await supabase
    .from('interviews')
    .select('id, applications!inner ( roles!inner ( company_id ) )')
    .eq('id', parsed.data.interviewId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!interview) return { error: 'That interview no longer exists.' };

  const companyId =
    (interview.applications as unknown as { roles: { company_id: string | null } } | null)?.roles
      ?.company_id ?? null;

  // Someone of that name already on this company is the same person, not a
  // second copy of them: typing a name that is already in the list should
  // attach the record rather than fork it.
  const byName = supabase
    .from('contacts')
    .select('id')
    .eq('user_id', user.id)
    .eq('full_name', parsed.data.name);

  const { data: existing } = await (
    companyId ? byName.eq('company_id', companyId) : byName.is('company_id', null)
  )
    .limit(1)
    .maybeSingle();

  let contactId = (existing?.id as string | undefined) ?? null;

  if (!contactId) {
    const { data: created, error } = await supabase
      .from('contacts')
      .insert({
        user_id: user.id,
        company_id: companyId,
        full_name: parsed.data.name,
        relationship: 'interviewer',
      })
      .select('id')
      .single();

    if (error || !created) return { error: error?.message ?? 'Could not add that person.' };
    contactId = created.id as string;
  }

  const { error } = await supabase.from('interview_participants').upsert(
    {
      interview_id: parsed.data.interviewId,
      contact_id: contactId,
      role: 'interviewer',
    },
    { onConflict: 'interview_id,contact_id', ignoreDuplicates: true },
  );

  if (error) return { error: error.message };

  revalidatePath('/jobs/interviews');
  revalidatePath('/jobs/roles/[id]', 'page');
  revalidatePath('/jobs/contacts');
  return { error: null };
}

export async function removeInterviewer(input: {
  interviewId: string;
  contactId: string;
}): Promise<{ error: string | null }> {
  const parsed = participantSchema.safeParse(input);
  if (!parsed.success) return { error: 'That is not a person to remove.' };

  await requireUser();
  const supabase = await createClient();

  const { error } = await supabase
    .from('interview_participants')
    .delete()
    .eq('interview_id', parsed.data.interviewId)
    .eq('contact_id', parsed.data.contactId);

  if (error) return { error: error.message };
  revalidatePath('/jobs/interviews');
  revalidatePath('/jobs/roles/[id]', 'page');
  return { error: null };
}

const groupSchema = z.object({
  applicationId: z.string().uuid(),
  interviewIds: z.array(z.string().uuid()).min(2, 'A group needs at least two rounds.').max(20),
  label: z.string().trim().max(120).optional(),
});

/**
 * Gather several interviews into one round.
 *
 * The interviews themselves are untouched -- each keeps its hour, its panel and
 * its own notes, which is the whole point of gathering rather than merging.
 * What the round adds is somewhere to write how the day went, which belonged
 * to none of them individually and so had nowhere to go at all.
 *
 * Each of them was in a round of its own before this, so the rounds they leave
 * behind are swept up: an empty round the user never made and cannot see the
 * purpose of is litter, and the next visit would offer to gather it again.
 */
export async function groupInterviews(input: {
  applicationId: string;
  interviewIds: string[];
  label?: string;
}): Promise<{ error: string | null }> {
  const parsed = groupSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const user = await requireUser();
  const supabase = await createClient();

  // Noted before the move, because afterwards there is no way back to them.
  const { data: leaving } = await supabase
    .from('interviews')
    .select('group_id')
    .in('id', parsed.data.interviewIds)
    .eq('application_id', parsed.data.applicationId)
    .eq('user_id', user.id);

  const vacated = [
    ...new Set(
      (leaving ?? [])
        .map((row) => row.group_id as string | null)
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  const round = await roundForNewInterview(supabase, {
    userId: user.id,
    applicationId: parsed.data.applicationId,
    groupId: null,
  });
  if (!round.groupId) return { error: round.error };

  if (parsed.data.label) {
    await supabase
      .from('interview_groups')
      .update({ label: parsed.data.label })
      .eq('id', round.groupId)
      .eq('user_id', user.id);
  }

  const { error } = await supabase
    .from('interviews')
    .update({ group_id: round.groupId })
    .in('id', parsed.data.interviewIds)
    .eq('application_id', parsed.data.applicationId)
    .eq('user_id', user.id);

  if (error) {
    // A round with nothing in it is litter, and the next visit would offer to
    // make another one beside it.
    await supabase.from('interview_groups').delete().eq('id', round.groupId).eq('user_id', user.id);
    return { error: error.message };
  }

  await deleteEmptyRounds(supabase, { userId: user.id, groupIds: vacated });

  revalidatePath('/jobs/roles/[id]', 'page');
  return { error: null };
}

/**
 * Drop the rounds among these that nothing is left in.
 *
 * Only ever called for rounds the app itself made a moment ago to hold one
 * interview. A round the user made and then emptied is theirs to keep or
 * remove; this is for the ones they never saw.
 */
async function deleteEmptyRounds(
  supabase: AppSupabaseClient,
  opts: { userId: string; groupIds: readonly string[] },
): Promise<void> {
  for (const groupId of opts.groupIds) {
    const { count } = await supabase
      .from('interviews')
      .select('id', { count: 'exact', head: true })
      .eq('group_id', groupId);
    if (count) continue;

    await supabase
      .from('interview_groups')
      .delete()
      .eq('id', groupId)
      .eq('user_id', opts.userId);
  }
}

const newRoundSchema = z.object({
  applicationId: z.string().uuid(),
  label: z.string().trim().max(120).optional(),
  roundNumber: z.number().int().min(1, 'Rounds start at 1.').max(99).optional(),
});

/**
 * A round with nothing in it yet.
 *
 * `groupInterviews` makes a round out of interviews that already exist, which
 * only works when the mail arrived first. A round is usually agreed before any
 * of it is booked — "there will be a technical round, we will send times" —
 * and the conversations inside it turn up one at a time afterwards, some from
 * the inbox and some by hand. So the container comes first and fills up, which
 * is the way round the user actually works.
 */
export async function createInterviewRound(input: {
  applicationId: string;
  label?: string;
  /** Which round of the process. Defaults to one past the highest so far. */
  roundNumber?: number;
}): Promise<{ id: string | null; error: string | null }> {
  const parsed = newRoundSchema.safeParse(input);
  if (!parsed.success) return { id: null, error: parsed.error.issues[0].message };

  const user = await requireUser();
  const supabase = await createClient();

  let roundNumber = parsed.data.roundNumber;
  if (roundNumber === undefined) {
    const { data: rounds } = await supabase
      .from('interview_groups')
      .select('round_number')
      .eq('application_id', parsed.data.applicationId)
      .eq('user_id', user.id);
    roundNumber =
      (rounds ?? []).reduce(
        (top, row) => Math.max(top, (row.round_number as number | null) ?? 0),
        0,
      ) + 1;
  }

  const { data, error } = await supabase
    .from('interview_groups')
    .insert({
      user_id: user.id,
      application_id: parsed.data.applicationId,
      label: parsed.data.label || null,
      round_number: roundNumber,
    })
    .select('id')
    .single();

  if (error || !data) return { id: null, error: error?.message ?? 'Could not add the round.' };

  revalidatePath('/jobs/roles/[id]', 'page');
  return { id: data.id as string, error: null };
}

/**
 * Drop a round, which is only ever offered for an empty one.
 *
 * An interview cannot exist outside a round any more, so the membership can no
 * longer be nulled and the foreign key cascades instead. That makes "only when
 * empty" a rule with teeth behind it rather than a nicety, and it is enforced
 * below as well as in the card.
 */
export async function deleteInterviewRound(groupId: string): Promise<{ error: string | null }> {
  const parsed = z.string().uuid().safeParse(groupId);
  if (!parsed.success) return { error: 'That is not a round.' };

  const user = await requireUser();
  const supabase = await createClient();

  // Checked here and not only in the card. Now that an interview cannot exist
  // outside a round, the foreign key cascades -- so a request that reached
  // this with interviews still in the round would take them with it.
  const { count } = await supabase
    .from('interviews')
    .select('id', { count: 'exact', head: true })
    .eq('group_id', parsed.data);

  if (count) {
    return { error: 'Take the interviews out of this round before removing it.' };
  }

  const { error } = await supabase
    .from('interview_groups')
    .delete()
    .eq('id', parsed.data)
    .eq('user_id', user.id);

  if (error) return { error: error.message };
  revalidatePath('/jobs/roles/[id]', 'page');
  return { error: null };
}

const groupPatchSchema = z.object({
  groupId: z.string().uuid(),
  label: z.string().trim().max(120).optional(),
  notes: z.string().max(20_000).optional(),
  roundNumber: z.number().int().min(1, 'Rounds start at 1.').max(99).nullable().optional(),
});

/**
 * The round's number, its name, and the impression of it as a whole.
 *
 * The number lives here rather than on each interview: a round is the thing
 * that is first or second or final, and the four conversations of a superday
 * are all the same round however they are ordered within the day.
 */
export async function saveInterviewGroup(
  groupId: string,
  patch: { label?: string; notes?: string; roundNumber?: number | null },
): Promise<{ error: string | null }> {
  const parsed = groupPatchSchema.safeParse({ groupId, ...patch });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const update: Record<string, unknown> = {};
  if (parsed.data.label !== undefined) update.label = parsed.data.label || null;
  if (parsed.data.notes !== undefined) update.notes = parsed.data.notes || null;
  if (parsed.data.roundNumber !== undefined) update.round_number = parsed.data.roundNumber;

  const user = await requireUser();
  const supabase = await createClient();

  const { error } = await supabase
    .from('interview_groups')
    .update(update)
    .eq('id', parsed.data.groupId)
    .eq('user_id', user.id);

  if (error) return { error: error.message };
  revalidatePath('/jobs/roles/[id]', 'page');
  return { error: null };
}

const roundMessageSchema = z.object({
  groupId: z.string().uuid(),
  messageId: z.string().uuid(),
});

/**
 * Say which email this round is about.
 *
 * The invitation, the reschedule, the panel list: a round is regularly
 * described by several messages, and until now none of them could be attached
 * to it. "Add from email" on the interview form only ever copied the kind
 * across and named the subject once, so a round that already existed had no
 * way to be told what it came out of.
 *
 * The message is picked from the mail already linked to this pursuit, so this
 * never reaches across pursuits — it is only ever saying which of the emails
 * on this role belong to which round of it.
 */
export async function linkRoundMessage(input: {
  groupId: string;
  messageId: string;
}): Promise<{ error: string | null }> {
  const parsed = roundMessageSchema.safeParse(input);
  if (!parsed.success) return { error: 'That is not an email to add.' };

  const user = await requireUser();
  const supabase = await createClient();

  // RLS would refuse another account's message, but a zero-row write explains
  // nothing; the check is here for a sentence worth reading.
  const { data: message } = await supabase
    .from('inbox_messages')
    .select('id')
    .eq('id', parsed.data.messageId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!message) return { error: 'That message is no longer in the mailbox.' };

  const { error } = await supabase.from('interview_group_messages').upsert(
    {
      user_id: user.id,
      group_id: parsed.data.groupId,
      message_id: parsed.data.messageId,
    },
    { onConflict: 'group_id,message_id' },
  );

  if (error) return { error: error.message };
  revalidatePath('/jobs/roles/[id]', 'page');
  return { error: null };
}

/**
 * Take an email back off a round.
 *
 * Only the statement that the two belong together goes. The message stays
 * linked to the pursuit and keeps its place on the timeline — this is the
 * round being corrected, not the mail being unlinked.
 */
export async function unlinkRoundMessage(input: {
  groupId: string;
  messageId: string;
}): Promise<{ error: string | null }> {
  const parsed = roundMessageSchema.safeParse(input);
  if (!parsed.success) return { error: 'That is not an email to remove.' };

  const user = await requireUser();
  const supabase = await createClient();

  const { error } = await supabase
    .from('interview_group_messages')
    .delete()
    .eq('group_id', parsed.data.groupId)
    .eq('message_id', parsed.data.messageId)
    .eq('user_id', user.id);

  if (error) return { error: error.message };
  revalidatePath('/jobs/roles/[id]', 'page');
  return { error: null };
}

/**
 * Move an interview out of the round it is in and into one of its own.
 *
 * "Not part of this day" used to mean an interview with no round at all. It
 * cannot mean that any more -- every interview is inside one -- so it means
 * what the user was actually saying: this conversation is its own round, not
 * part of that one. The round it leaves survives even if that empties it,
 * because an empty round is a real state; `deleteInterviewRound` is how one
 * goes.
 */
export async function ungroupInterview(interviewId: string): Promise<{ error: string | null }> {
  const parsed = z.string().uuid().safeParse(interviewId);
  if (!parsed.success) return { error: 'That is not an interview.' };

  const user = await requireUser();
  const supabase = await createClient();

  const { data: interview } = await supabase
    .from('interviews')
    .select('id, group_id, application_id')
    .eq('id', parsed.data)
    .eq('user_id', user.id)
    .maybeSingle<{ id: string; group_id: string | null; application_id: string }>();

  if (!interview) return { error: 'That interview no longer exists.' };

  const round = await roundForNewInterview(supabase, {
    userId: user.id,
    applicationId: interview.application_id,
    groupId: null,
  });
  if (!round.groupId) return { error: round.error };

  const { error } = await supabase
    .from('interviews')
    .update({ group_id: round.groupId, round: 1 })
    .eq('id', parsed.data)
    .eq('user_id', user.id);

  if (error) return { error: error.message };

  revalidatePath('/jobs/roles/[id]', 'page');
  return { error: null };
}

/** The inbox read one scheduling thread as two rounds; this is how you say so. */
export async function deleteInterview(interviewId: string): Promise<{ error: string | null }> {
  const parsed = z.string().uuid().safeParse(interviewId);
  if (!parsed.success) return { error: 'That is not an interview.' };

  const user = await requireUser();
  const supabase = await createClient();

  const { error } = await supabase
    .from('interviews')
    .delete()
    .eq('id', parsed.data)
    .eq('user_id', user.id);

  if (error) return { error: error.message };
  revalidatePath('/jobs/interviews');
  revalidatePath('/jobs/roles/[id]', 'page');
  revalidatePath('/jobs/today');
  return { error: null };
}

/** Approve a suggested match, or one found through "add other": the same manual link the review queue writes. */
export async function linkCandidateMessage(
  messageId: string,
  applicationId: string,
): Promise<{ error: string | null }> {
  const result = await linkMessage(messageId, applicationId);
  if (!result.error) revalidatePath('/jobs/roles/[id]', 'page');
  return result;
}

const declineSchema = z.object({
  messageId: z.string().uuid(),
  applicationId: z.string().uuid(),
});

/**
 * "Not this one." Remembered per pursuit so the same suggestion does not keep
 * coming back — the message itself is untouched and can still be linked
 * elsewhere, or found again through "add other" if this was a mistake.
 */
export async function declineCandidateMessage(
  messageId: string,
  applicationId: string,
): Promise<{ error: string | null }> {
  const parsed = declineSchema.safeParse({ messageId, applicationId });
  if (!parsed.success) return { error: 'That is not a declinable pair.' };

  const user = await requireUser();
  const supabase = await createClient();

  const { error } = await supabase.from('message_link_dismissals').upsert(
    {
      user_id: user.id,
      application_id: parsed.data.applicationId,
      message_id: parsed.data.messageId,
    },
    { onConflict: 'application_id,message_id' },
  );

  if (error) return { error: error.message };
  revalidatePath('/jobs/roles/[id]', 'page');
  return { error: null };
}

/** The "add other" search: any unlinked mail naming the search term, not just the company. */
export async function searchUnlinkedMessages(
  applicationId: string,
  term: string,
): Promise<{ results: UnlinkedMessage[]; error: string | null }> {
  const parsed = z.object({ applicationId: z.string().uuid(), term: z.string() }).safeParse({
    applicationId,
    term,
  });
  if (!parsed.success) return { results: [], error: 'That is not a valid search.' };

  const user = await requireUser();
  const supabase = await createClient();

  const results = await findUnlinkedMessages(supabase, user.id, {
    applicationId: parsed.data.applicationId,
    term: parsed.data.term,
  });
  return { results, error: null };
}

/**
 * The requirement match.
 *
 * Triggered by a click rather than computed on render: it costs a model call,
 * and a page you visit six times while deciding should not cost six. The
 * stored key is the other half of that — a match already computed against this
 * description and this bank is returned as it stands, and re-running is only
 * offered once one of the two has changed.
 */
const matchSchema = z.object({ roleId: z.string().uuid() });

export async function matchRoleRequirements(
  input: z.input<typeof matchSchema>,
): Promise<{ matches: RequirementMatch[] | null; error: string | null }> {
  const parsed = matchSchema.safeParse(input);
  if (!parsed.success) return { matches: null, error: parsed.error.issues[0].message };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { matches: null, error: 'Matching is not configured.' };

  const user = await requireUser();
  const supabase = await createClient();

  const { data: role, error: roleError } = await supabase
    .from('roles')
    .select('id, title, jd_hash, requirements, companies!inner ( name )')
    .eq('id', parsed.data.roleId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (roleError) return { matches: null, error: roleError.message };
  if (!role) return { matches: null, error: 'That role is not yours.' };

  const requirements = (role.requirements as Requirement[] | null) ?? [];
  if (requirements.length === 0) {
    return { matches: null, error: 'No requirements have been extracted from this description yet.' };
  }

  const { data: bank, error: bankError } = await supabase
    .from('evidence_items')
    .select('id, title, body, context, metrics, skills, strength')
    .eq('user_id', user.id);

  if (bankError) return { matches: null, error: bankError.message };

  const items = (bank ?? []).map((item) => ({
    id: item.id as string,
    title: item.title as string,
    body: item.body as string,
    context: (item.context as string) ?? null,
    metrics: (item.metrics as string) ?? null,
    skills: (item.skills as string[]) ?? [],
    strength: item.strength as number,
  }));

  // An empty bank is an error, not an empty-context fallback: a map built
  // against nothing would read as a role you are wholly unqualified for.
  if (items.length === 0) {
    return {
      matches: null,
      error: 'Your evidence bank is empty. Fill it in Settings first — the map is only as good as it is.',
    };
  }

  const company = role.companies as unknown as { name: string } | null;
  const result = await matchRequirements(
    { apiKey },
    {
      requirements,
      bank: shortlistEvidence(requirements, items),
      roleLabel: [company?.name, role.title as string].filter(Boolean).join(', '),
    },
  );

  if (!result.ok) return { matches: null, error: result.error };

  const { error: writeError } = await supabase
    .from('roles')
    .update({
      requirement_matches: result.matches,
      requirement_matches_at: new Date().toISOString(),
      requirement_matches_key: matchKey(role.jd_hash as string | null, items),
    })
    .eq('id', parsed.data.roleId)
    .eq('user_id', user.id);

  if (writeError) return { matches: null, error: writeError.message };

  revalidatePath(`/jobs/roles/${parsed.data.roleId}`);
  return { matches: result.matches, error: null };
}

/**
 * Sharing the case page.
 *
 * The slug is the whole authorization, so it is generated here from
 * `randomBytes` rather than from anything derivable — not the application id,
 * not a hash of the role, not a timestamp. 24 bytes is 192 bits; a guessing
 * attack is not the threat model, but a slug that could be enumerated from a
 * neighbouring one would be.
 *
 * The expiry is not optional. A link with no end is a link that outlives the
 * application, the job and your interest in the company, and the read function
 * refuses a row that has none — so this always sets one.
 */
const SHARE_DAYS = 30;

const shareSchema = z.object({
  applicationId: z.string().uuid(),
  /** The statement of interest. Written by hand; nothing generates it. */
  body: z.string().trim().max(8000).optional(),
});

export async function shareCasePage(
  input: z.input<typeof shareSchema>,
): Promise<{ slug: string | null; expiresAt: string | null; error: string | null }> {
  const parsed = shareSchema.safeParse(input);
  if (!parsed.success) return { slug: null, expiresAt: null, error: parsed.error.issues[0].message };

  const user = await requireUser();
  const supabase = await createClient();

  const { data: application, error: appError } = await supabase
    .from('applications')
    .select('id, roles!inner ( requirement_matches )')
    .eq('id', parsed.data.applicationId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (appError) return { slug: null, expiresAt: null, error: appError.message };
  if (!application) return { slug: null, expiresAt: null, error: 'That pursuit is not yours.' };

  // A page with no matched requirements is a page with a paragraph on it. The
  // requirement map is the thing worth sending; refusing here is friendlier
  // than shipping an empty link to an employer.
  const matches =
    ((application.roles as unknown as { requirement_matches: RequirementMatch[] | null })
      .requirement_matches ?? []).filter((match) => match.verdict !== 'gap');
  if (matches.length === 0) {
    return {
      slug: null,
      expiresAt: null,
      error: 'Match the requirements first — without the map there is nothing to show.',
    };
  }

  const slug = randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + SHARE_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data: existing } = await supabase
    .from('cover_letters')
    .select('id')
    .eq('application_id', parsed.data.applicationId)
    .eq('user_id', user.id)
    .maybeSingle();

  const patch = {
    public_slug: slug,
    public_expires_at: expiresAt,
    ...(parsed.data.body !== undefined ? { body: parsed.data.body } : {}),
  };

  const { error } = existing
    ? await supabase
        .from('cover_letters')
        .update(patch)
        .eq('id', existing.id)
        .eq('user_id', user.id)
    : await supabase.from('cover_letters').insert({
        user_id: user.id,
        application_id: parsed.data.applicationId,
        body: parsed.data.body ?? null,
        ...patch,
      });

  if (error) return { slug: null, expiresAt: null, error: error.message };

  revalidatePath('/jobs/roles/[id]', 'page');
  return { slug, expiresAt, error: null };
}

/**
 * Stop sharing.
 *
 * Clearing the expiry as well as the slug, because the read function checks
 * both and a row with a live expiry and no slug is a row one careless update
 * away from being public again.
 */
export async function unshareCasePage(
  applicationId: string,
): Promise<{ error: string | null }> {
  const parsed = z.string().uuid().safeParse(applicationId);
  if (!parsed.success) return { error: 'That is not a pursuit.' };

  const user = await requireUser();
  const supabase = await createClient();

  const { error } = await supabase
    .from('cover_letters')
    .update({ public_slug: null, public_expires_at: null })
    .eq('application_id', parsed.data)
    .eq('user_id', user.id);

  if (error) return { error: error.message };
  revalidatePath('/jobs/roles/[id]', 'page');
  return { error: null };
}
