import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import { INTERVIEW_KINDS, type InterviewKind } from '@/lib/jobs/interview-kinds';

/**
 * A round for an interview the mail announced without a time.
 *
 * An invitation to sit an AI interview, or an interview email whose time was
 * not read, files an "interview scheduled" event with no date and no calendar
 * invite, so nothing used to book a round for it and the pursuit read as
 * never having reached an interview (plan #1588). This books one with the date to be set,
 * which the invite or the dated email that follows fills in rather than
 * booking a second.
 *
 * Only where the pursuit has no interview at all: one already on file is the
 * round the email is about, or near enough that a second guessed round would
 * be noise.
 */
export async function ensureInterviewRound(
  supabase: AppSupabaseClient,
  opts: { userId: string; applicationId: string; kind: string | null },
): Promise<{ groupId: string; interviewId: string; groupCreated: boolean } | null> {
  const { data: booked } = await supabase
    .from('interviews')
    .select('id')
    .eq('application_id', opts.applicationId)
    .eq('user_id', opts.userId)
    .limit(1);
  if ((booked ?? []).length > 0) return null;

  // A round with nobody in it yet is the round this goes in.
  const { data: rounds } = await supabase
    .from('interview_groups')
    .select('id, round_number')
    .eq('application_id', opts.applicationId)
    .eq('user_id', opts.userId)
    .order('round_number', { ascending: true })
    .limit(1);

  let groupId = (rounds ?? [])[0]?.id as string | undefined;
  const groupCreated = !groupId;
  if (!groupId) {
    const { data: group } = await supabase
      .from('interview_groups')
      .insert({ user_id: opts.userId, application_id: opts.applicationId, round_number: 1 })
      .select('id')
      .maybeSingle();
    groupId = group?.id as string | undefined;
  }
  if (!groupId) return null;

  const kind: InterviewKind = INTERVIEW_KINDS.includes(opts.kind as InterviewKind)
    ? (opts.kind as InterviewKind)
    : 'recruiter_screen';

  const { data: created } = await supabase
    .from('interviews')
    .insert({
      user_id: opts.userId,
      application_id: opts.applicationId,
      group_id: groupId,
      round: 1,
      kind,
      scheduled_at: null,
      status: 'scheduled',
    })
    .select('id')
    .maybeSingle();
  if (!created) return null;

  return { groupId, interviewId: created.id as string, groupCreated };
}
