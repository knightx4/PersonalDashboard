'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, requireUser } from '@/lib/jobs/auth/server';
import { linkMessage } from '@/app/jobs/(app)/review/actions';
import { findUnlinkedMessages, type UnlinkedMessage } from '@/lib/jobs/inbox/link-candidates';
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
    notes?: string;
    status?: 'scheduled' | 'completed' | 'cancelled' | 'rescheduled';
  },
): Promise<{ error: string | null }> {
  const user = await requireUser();
  const supabase = await createClient();

  const update: Record<string, unknown> = {};
  if (patch.prepNotes !== undefined) update.prep_notes = patch.prepNotes || null;
  if (patch.notes !== undefined) update.notes = patch.notes || null;
  if (patch.status !== undefined) update.status = patch.status;

  const { error } = await supabase
    .from('interviews')
    .update(update)
    .eq('id', interviewId)
    .eq('user_id', user.id);

  if (error) return { error: error.message };
  revalidatePath('/jobs/interviews');
  revalidatePath('/jobs/roles/[id]', 'page');
  return { error: null };
}

const addInterviewSchema = z.object({
  applicationId: z.string().uuid(),
  round: z.number().int().min(1),
  kind: z.enum([
    'recruiter_screen',
    'hiring_manager',
    'technical',
    'case',
    'panel',
    'onsite',
    'final',
    'informal',
  ]),
  scheduledAt: z.string().min(1, 'Pick a date.'),
});

/**
 * A round the inbox never saw mail about -- a phone screen nobody emailed
 * you the invite for, or the same case with `deleteInterview`: a round the
 * inbox saw twice.
 */
export async function addInterview(input: {
  applicationId: string;
  round: number;
  kind: string;
  scheduledAt: string;
}): Promise<{ error: string | null }> {
  const parsed = addInterviewSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const user = await requireUser();
  const supabase = await createClient();

  const { error } = await supabase.from('interviews').insert({
    user_id: user.id,
    application_id: parsed.data.applicationId,
    round: parsed.data.round,
    kind: parsed.data.kind,
    scheduled_at: parsed.data.scheduledAt,
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
