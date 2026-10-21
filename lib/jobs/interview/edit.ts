import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import { addContact } from '@/lib/jobs/contacts/edit';

/**
 * Changing interviews and rounds once they exist, as the role page's round
 * cards and Dash's change_interview, change_interviewer,
 * change_interview_round and link_round_email write them (plan #2473.2).
 * Each returns what it wrote, so Dash can keep it for its Undo. Making a
 * round or an interview is ./rounds.ts.
 */

type Row = Record<string, unknown>;
type Written = { row: Row | null; error: string | null };
type Many = { rows: Row[]; error: string | null };

async function one(query: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<Written> {
  const { data, error } = await query;
  if (error) return { row: null, error: error.message };
  return { row: (data as Row | null) ?? null, error: null };
}

async function many(query: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<Many> {
  const { data, error } = await query;
  if (error) return { rows: [], error: error.message };
  return { rows: (data ?? []) as Row[], error: null };
}

/** An interview's kind, status, when, notes or prep notes. */
export function saveInterviewEdit(supabase: AppSupabaseClient, userId: string, interviewId: string, update: Row): Promise<Written> {
  return one(supabase.from('interviews').update(update).eq('id', interviewId).eq('user_id', userId).select('*').maybeSingle());
}

/**
 * A contact named as an interviewer on an interview. Naming someone already
 * on it changes nothing and gives no row back. interview_participants has no
 * user_id: it is the person's through its interview, which the caller has
 * checked, and a trigger refuses another person's contact.
 */
export function addInterviewerRow(supabase: AppSupabaseClient, interviewId: string, contactId: string): Promise<Written> {
  return one(
    supabase
      .from('interview_participants')
      .upsert({ interview_id: interviewId, contact_id: contactId, role: 'interviewer' }, { onConflict: 'interview_id,contact_id', ignoreDuplicates: true })
      .select('*')
      .maybeSingle(),
  );
}

/** A contact taken off an interview; the rows taken out, whole. */
export function removeInterviewerRow(supabase: AppSupabaseClient, interviewId: string, contactId: string): Promise<Many> {
  return many(supabase.from('interview_participants').delete().eq('interview_id', interviewId).eq('contact_id', contactId).select('*'));
}

/** Their contacts called `name`, ignoring case, at `companyId` (none for no company). */
export async function interviewersNamed(
  supabase: AppSupabaseClient,
  userId: string,
  companyId: string | null,
  name: string,
): Promise<Many> {
  const found = await many(
    supabase.from('contacts').select('*').eq('user_id', userId).ilike('full_name', name.replace(/[\\%_]/g, (c) => `\\${c}`)),
  );
  return { rows: found.rows.filter((row) => (row.company_id ?? null) === companyId), error: found.error };
}

/**
 * The contact an interviewer named by hand becomes: someone of that name at
 * the role's company already is the same person, so they are attached rather
 * than copied; otherwise a contact is made there, as an interviewer.
 */
export async function interviewerContact(
  supabase: AppSupabaseClient,
  userId: string,
  companyId: string | null,
  name: string,
): Promise<{ contact: Row | null; made: boolean; error: string | null }> {
  const same = await interviewersNamed(supabase, userId, companyId, name);
  if (same.error) return { contact: null, made: false, error: same.error };
  if (same.rows[0]) return { contact: same.rows[0], made: false, error: null };
  const added = await addContact(supabase, userId, { company_id: companyId, full_name: name, relationship: 'interviewer' });
  return { contact: added.row, made: added.row !== null, error: added.error ?? (added.row ? null : 'Could not add that person.') };
}

/** A round's name, notes or number. */
export function saveRoundEdit(supabase: AppSupabaseClient, userId: string, groupId: string, update: Row): Promise<Written> {
  return one(supabase.from('interview_groups').update(update).eq('id', groupId).eq('user_id', userId).select('*').maybeSingle());
}

/** An interview moved into another round, at `place` within it. */
export function moveInterviewToRound(
  supabase: AppSupabaseClient,
  userId: string,
  interviewId: string,
  groupId: string,
  place: number,
): Promise<Written> {
  return one(
    supabase.from('interviews').update({ group_id: groupId, round: place }).eq('id', interviewId).eq('user_id', userId).select('*').maybeSingle(),
  );
}

/** Say an email is about a round. Saying it twice changes nothing. */
export function linkRoundEmailRow(supabase: AppSupabaseClient, userId: string, groupId: string, messageId: string): Promise<Written> {
  return one(
    supabase
      .from('interview_group_messages')
      .upsert({ user_id: userId, group_id: groupId, message_id: messageId }, { onConflict: 'group_id,message_id' })
      .select('*')
      .maybeSingle(),
  );
}

/**
 * Take an email back off a round; the rows taken out, whole. The message
 * stays on the pursuit and its timeline: only the statement that the two
 * belong together goes.
 */
export function unlinkRoundEmailRow(supabase: AppSupabaseClient, userId: string, groupId: string, messageId: string): Promise<Many> {
  return many(
    supabase.from('interview_group_messages').delete().eq('group_id', groupId).eq('message_id', messageId).eq('user_id', userId).select('*'),
  );
}

/** What gathering interviews into a round wrote, row by row, so Dash can keep it for its Undo. */
export type Gathered = {
  /** The interviews moved in, as they were and as they are now. */
  moved: { before: Row; after: Row }[];
  /** The emails of the rounds they left, now on the round they went into. */
  relinked: { before: Row; after: Row }[];
  /** Links taken out because the email was already on the round they went into. */
  unlinked: Row[];
  /** The rounds left with nothing in them, taken out whole. */
  removed: Row[];
  error: string | null;
};

/**
 * Interviews gathered into one round, as the role page's "Make them one
 * round" and Dash's change_interview_round group both do it (plan #2473.7).
 * Each interview keeps its hour, panel and notes and is placed after those
 * already in the round, in the order given. The emails of the rounds they
 * leave go with them, and a round left with no interview and no notes of its
 * own is taken out, so nothing anyone wrote goes with it. `emptying` names
 * rounds to fold in that hold no interview at all, so their emails come too.
 *
 * Stops at the first failed write and says what it had done by then.
 */
export async function gatherIntoRound(
  supabase: AppSupabaseClient,
  userId: string,
  opts: { applicationId: string; groupId: string; interviewIds: readonly string[]; emptying?: readonly string[] },
): Promise<Gathered> {
  const done: Gathered = { moved: [], relinked: [], unlinked: [], removed: [], error: null };
  const fail = (error: string): Gathered => ({ ...done, error });

  const found = await many(
    supabase.from('interviews').select('*').in('id', [...opts.interviewIds]).eq('application_id', opts.applicationId).eq('user_id', userId),
  );
  if (found.error) return fail(found.error);
  const byId = new Map(found.rows.map((row) => [row.id as string, row]));
  const named: Row[] = [];
  for (const id of new Set(opts.interviewIds)) {
    const row = byId.get(id);
    if (!row) return fail('Some of those interviews are not on this role.');
    named.push(row);
  }

  const leaving = [...new Set([...named.map((row) => row.group_id as string | null), ...(opts.emptying ?? [])])].filter(
    (id): id is string => Boolean(id) && id !== opts.groupId,
  );

  const already = await many(supabase.from('interviews').select('id').eq('group_id', opts.groupId).eq('user_id', userId));
  if (already.error) return fail(already.error);
  let place = already.rows.length;
  for (const interview of named) {
    if (interview.group_id === opts.groupId) continue;
    place += 1;
    const after = await moveInterviewToRound(supabase, userId, interview.id as string, opts.groupId, place);
    if (after.error || !after.row) return fail(after.error ?? 'An interview changed while it was being moved.');
    done.moved.push({ before: interview, after: after.row });
  }

  const kept = await many(supabase.from('interview_group_messages').select('message_id').eq('group_id', opts.groupId).eq('user_id', userId));
  if (kept.error) return fail(kept.error);
  const onRound = new Set(kept.rows.map((row) => row.message_id));
  for (const groupId of leaving) {
    const links = await many(supabase.from('interview_group_messages').select('*').eq('group_id', groupId).eq('user_id', userId));
    if (links.error) return fail(links.error);
    for (const link of links.rows) {
      if (onRound.has(link.message_id)) {
        const taken = await many(supabase.from('interview_group_messages').delete().eq('id', link.id as string).eq('user_id', userId).select('*'));
        if (taken.error) return fail(taken.error);
        done.unlinked.push(...taken.rows);
        continue;
      }
      const after = await one(
        supabase
          .from('interview_group_messages')
          .update({ group_id: opts.groupId })
          .eq('id', link.id as string)
          .eq('user_id', userId)
          .select('*')
          .maybeSingle(),
      );
      if (after.error || !after.row) return fail(after.error ?? 'An email changed while it was being moved.');
      done.relinked.push({ before: link, after: after.row });
      onRound.add(link.message_id);
    }

    const round = await one(supabase.from('interview_groups').select('*').eq('id', groupId).eq('user_id', userId).maybeSingle());
    if (round.error) return fail(round.error);
    if (!round.row || (typeof round.row.notes === 'string' && round.row.notes.trim())) continue;
    const inside = await many(supabase.from('interviews').select('id').eq('group_id', groupId).eq('user_id', userId));
    if (inside.error) return fail(inside.error);
    if (inside.rows.length > 0) continue;
    const taken = await many(supabase.from('interview_groups').delete().eq('id', groupId).eq('user_id', userId).select('*'));
    if (taken.error) return fail(taken.error);
    done.removed.push(...taken.rows);
  }
  return done;
}
