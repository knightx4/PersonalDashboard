'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, requireUser } from '@/lib/jobs/auth/server';
import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import { INTERVIEW_KINDS } from '@/lib/jobs/interview-kinds';
import { insertInterview, insertInterviewRound } from '@/lib/jobs/interview/rounds';
import {
  addInterviewerRow,
  gatherIntoRound,
  interviewerContact,
  linkRoundEmailRow,
  moveInterviewToRound,
  removeInterviewerRow,
  saveInterviewEdit,
  saveRoundEdit,
  unlinkRoundEmailRow,
} from '@/lib/jobs/interview/edit';

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
// latency: pending
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

  const { error } = await saveInterviewEdit(supabase, user.id, interviewId, update);

  if (error) return { error };
  revalidatePath('/jobs/interviews');
  revalidatePath('/jobs/roles/[id]', 'page');
  revalidatePath('/jobs');
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
  const round = await insertInterviewRound(supabase, opts);
  return { groupId: round.id, error: round.error };
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
// latency: pending
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

  const { error } = await insertInterview(supabase, {
    userId: user.id,
    applicationId: parsed.data.applicationId,
    groupId: round.groupId,
    kind: parsed.data.kind,
    scheduledAt: parsed.data.schedule.scheduledAt,
    timeKnown: parsed.data.schedule.timeKnown,
  });

  if (error) return { error };
  revalidatePath('/jobs/interviews');
  revalidatePath('/jobs/roles/[id]', 'page');
  revalidatePath('/jobs');
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
// latency: pending
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

  const { error } = await addInterviewerRow(supabase, parsed.data.interviewId, parsed.data.contactId);

  if (error) return { error };
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
// latency: pending
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
  const { contact, error: contactError } = await interviewerContact(supabase, user.id, companyId, parsed.data.name);
  if (contactError || !contact) return { error: contactError ?? 'Could not add that person.' };

  const { error } = await addInterviewerRow(supabase, parsed.data.interviewId, contact.id as string);

  if (error) return { error };

  revalidatePath('/jobs/interviews');
  revalidatePath('/jobs/roles/[id]', 'page');
  revalidatePath('/jobs/contacts');
  return { error: null };
}

// latency: pending
export async function removeInterviewer(input: {
  interviewId: string;
  contactId: string;
}): Promise<{ error: string | null }> {
  const parsed = participantSchema.safeParse(input);
  if (!parsed.success) return { error: 'That is not a person to remove.' };

  await requireUser();
  const supabase = await createClient();

  const { error } = await removeInterviewerRow(supabase, parsed.data.interviewId, parsed.data.contactId);

  if (error) return { error };
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
 * Their emails come into the new round first, and one left holding notes is
 * kept (gatherIntoRound, which Dash's change_interview_round calls too).
 */
// latency: pending
export async function groupInterviews(input: {
  applicationId: string;
  interviewIds: string[];
  label?: string;
}): Promise<{ error: string | null }> {
  const parsed = groupSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const user = await requireUser();
  const supabase = await createClient();

  const round = await insertInterviewRound(supabase, {
    userId: user.id,
    applicationId: parsed.data.applicationId,
    label: parsed.data.label,
  });
  if (!round.id) return { error: round.error };

  const gathered = await gatherIntoRound(supabase, user.id, {
    applicationId: parsed.data.applicationId,
    groupId: round.id,
    interviewIds: parsed.data.interviewIds,
  });

  if (gathered.error) {
    // A round with nothing in it is litter, and the next visit would offer to
    // make another one beside it. Once an interview is in it, it stays: taking
    // the round out would take the interview with it.
    if (gathered.moved.length === 0) {
      await supabase.from('interview_groups').delete().eq('id', round.id).eq('user_id', user.id);
    }
    return { error: gathered.error };
  }

  revalidatePath('/jobs/roles/[id]', 'page');
  return { error: null };
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
// latency: pending
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

  const { id, error } = await insertInterviewRound(supabase, {
    userId: user.id,
    applicationId: parsed.data.applicationId,
    label: parsed.data.label,
    roundNumber: parsed.data.roundNumber,
  });
  if (error || !id) return { id: null, error: error ?? 'Could not add the round.' };

  revalidatePath('/jobs/roles/[id]', 'page');
  return { id, error: null };
}

/**
 * Drop a round, which is only ever offered for an empty one.
 *
 * An interview cannot exist outside a round any more, so the membership can no
 * longer be nulled and the foreign key cascades instead. That makes "only when
 * empty" a rule with teeth behind it rather than a nicety, and it is enforced
 * below as well as in the card.
 */
// latency: pending
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
// latency: pending
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

  const { error } = await saveRoundEdit(supabase, user.id, parsed.data.groupId, update);

  if (error) return { error };
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
// latency: pending
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

  const { error } = await linkRoundEmailRow(supabase, user.id, parsed.data.groupId, parsed.data.messageId);

  if (error) return { error };
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
// latency: pending
export async function unlinkRoundMessage(input: {
  groupId: string;
  messageId: string;
}): Promise<{ error: string | null }> {
  const parsed = roundMessageSchema.safeParse(input);
  if (!parsed.success) return { error: 'That is not an email to remove.' };

  const user = await requireUser();
  const supabase = await createClient();

  const { error } = await unlinkRoundEmailRow(supabase, user.id, parsed.data.groupId, parsed.data.messageId);

  if (error) return { error };
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
// latency: pending
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

  const { error } = await moveInterviewToRound(supabase, user.id, parsed.data, round.groupId, 1);

  if (error) return { error };

  revalidatePath('/jobs/roles/[id]', 'page');
  return { error: null };
}

/** The inbox read one scheduling thread as two rounds; this is how you say so. */
// latency: pending
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
  revalidatePath('/jobs');
  return { error: null };
}
