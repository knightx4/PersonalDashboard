import type { Requirement } from '@/lib/jobs/jd/requirements';
import type { SpendReport } from '@/lib/core/spend/pricing';
import type { RequirementMatch } from '@/lib/jobs/evidence/match-payload';
import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import { buildPrepContext } from '@/lib/jobs/interview/prep-context';
import { prepKey, type PrepNote } from '@/lib/jobs/interview/prep-payload';
import { writePrepNote } from '@/lib/jobs/interview/prep';

/**
 * Write, or return, the prep note for the round one conversation belongs to.
 * It is the body of the "Prepare me" button (writeRoundPrepNote in
 * app/jobs/(app)/roles/[id]/prep-actions.ts) and of Dash's write_prep_note
 * (plan #2044.3), so both refuse and spend the same way. The caller brings the
 * person's job_search client, their id and the key, and records `spend`.
 */

/** Rows as the joins hand them back, before the context step trims them. */
type PrepContactJoin = {
  id: string;
  full_name: string;
  title: string | null;
  relationship: string | null;
  how_we_connect: string | null;
  notes: string | null;
  linkedin_url: string | null;
};

type PrepConversationJoin = {
  id: string;
  kind: string;
  scheduled_at: string | null;
  time_known: boolean | null;
  duration_minutes: number | null;
  format: string | null;
  interview_participants: { role: string; contacts: PrepContactJoin | null }[] | null;
};

type PrepPriorJoin = {
  id: string;
  kind: string;
  scheduled_at: string | null;
  questions_asked: string[] | null;
  notes: string | null;
  applications: { roles: { title: string } | null } | null;
};

/** How far back a company's earlier rounds are worth reading. */
const PREP_PRIOR_LOOKBACK = 24;

export type PrepareRoundResult = {
  note: PrepNote | null;
  error: string | null;
  /** The role the round is on, for the caller to revalidate its page. */
  roleId: string | null;
  /** Whether a model run was made. False for a note returned as it was stored. */
  spent: boolean;
  /** What the run cost, for the caller to record. */
  spend: SpendReport[];
};

/**
 * Write the prep note for the round one conversation belongs to.
 *
 * Modelled on matchRoleRequirements above, and the same refusals apply for the
 * same reasons: no key in the environment, an interview that is not yours, and
 * nothing to ground on. That last one matters most — a note written with no
 * description and an empty bank is a note about interviews in general, and it
 * would read exactly like one written from a full posting.
 *
 * The note belongs to the round rather than to the conversation the button was
 * pressed on, per the decision on #64. It is stored on the round's earliest
 * conversation and every conversation in the round reads that one, which is
 * what a superday needs: one note about the day, not four about its quarters.
 *
 * A second press is free. The key fingerprints what the note was written
 * against, so pressing again returns the stored note untouched until one of
 * those facts changes or the person explicitly regenerates. Without that, a
 * button on a page anybody visits twice is a model call anybody pays for
 * twice.
 */
export async function prepareRound(
  supabase: AppSupabaseClient,
  input: { userId: string; interviewId: string; regenerate?: boolean; apiKey: string },
): Promise<PrepareRoundResult> {
  const user = { id: input.userId };
  const apiKey = input.apiKey;
  const parsed = { data: { interviewId: input.interviewId, regenerate: input.regenerate } };
  const fail = (error: string, roleId: string | null = null): PrepareRoundResult => ({
    note: null,
    error,
    roleId,
    spent: false,
    spend: [],
  });

  const { data: interview, error: interviewError } = await supabase
    .from('interviews')
    .select(
      `id, group_id,
       applications!inner (
         role_id,
         roles!inner (
           id, title, seniority, location, work_mode, jd_text, jd_hash, requirements,
           requirement_matches,
           companies!inner ( id, name, industry, stage, headcount_band, research, priority )
         )
       )`,
    )
    .eq('id', parsed.data.interviewId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (interviewError) return fail(interviewError.message);
  if (!interview) return fail('That round is not yours.');

  const application = interview.applications as unknown as {
    role_id: string;
    roles: {
      id: string;
      title: string;
      seniority: string | null;
      location: string | null;
      work_mode: string | null;
      jd_text: string | null;
      jd_hash: string | null;
      requirements: Requirement[] | null;
      requirement_matches: RequirementMatch[] | null;
      companies: {
        id: string;
        name: string;
        industry: string | null;
        stage: string | null;
        headcount_band: string | null;
        research: string | null;
        priority: string | null;
      };
    };
  };
  const role = application.roles;
  const company = role.companies;
  const groupId = (interview.group_id as string | null) ?? null;

  // The conversations of this round: all of them when it is a superday, the
  // one it was pressed on when there is no group row -- which is most rounds.
  const conversationQuery = supabase
    .from('interviews')
    .select(
      `id, kind, scheduled_at, time_known, duration_minutes, format,
       interview_participants (
         role,
         contacts ( id, full_name, title, relationship, how_we_connect, notes, linkedin_url )
       )`,
    )
    .eq('user_id', user.id);

  const since = new Date(Date.now() - PREP_PRIOR_LOOKBACK * 30 * 24 * 3600 * 1000).toISOString();

  const [
    { data: conversationRows, error: conversationError },
    { data: group },
    { data: priorRows },
    { data: bank, error: bankError },
    { data: profile },
  ] = await Promise.all([
    groupId
      ? conversationQuery.eq('group_id', groupId)
      : conversationQuery.eq('id', parsed.data.interviewId),
    groupId
      ? supabase
          .from('interview_groups')
          .select('label, round_number, notes')
          .eq('id', groupId)
          .eq('user_id', user.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    // Earlier rounds anywhere at this company, this pursuit or an older one.
    // What the screen asked last month is prep whichever role it was for.
    supabase
      .from('interviews')
      .select(
        'id, kind, scheduled_at, questions_asked, notes, applications!inner ( roles!inner ( title, company_id ) )',
      )
      .eq('user_id', user.id)
      .eq('applications.roles.company_id', company.id)
      .lt('scheduled_at', new Date().toISOString())
      .gt('scheduled_at', since)
      .order('scheduled_at', { ascending: false })
      .limit(20),
    supabase
      .from('evidence_items')
      .select('id, title, body, context, metrics, skills, strength')
      .eq('user_id', user.id),
    supabase
      .from('profiles')
      .select('target_titles, timezone, writing_style_notes, banned_constructions')
      .eq('id', user.id)
      .maybeSingle(),
  ]);

  if (conversationError) return fail(conversationError.message);
  if (bankError) return fail(bankError.message);

  const conversations = ((conversationRows ?? []) as unknown as PrepConversationJoin[]).map(
    (row) => ({
      id: row.id,
      kind: row.kind,
      scheduledAt: row.scheduled_at,
      timeKnown: row.time_known ?? true,
      durationMinutes: row.duration_minutes,
      format: row.format,
      participants: (row.interview_participants ?? []).map((participant) => ({
        role: participant.role,
        contact: participant.contacts
          ? {
              id: participant.contacts.id,
              fullName: participant.contacts.full_name,
              title: participant.contacts.title,
              relationship: participant.contacts.relationship,
              howWeConnect: participant.contacts.how_we_connect,
              notes: participant.contacts.notes,
              linkedinUrl: participant.contacts.linkedin_url,
            }
          : null,
      })),
    }),
  );

  const items = (bank ?? []).map((item) => ({
    id: item.id as string,
    title: item.title as string,
    body: item.body as string,
    context: (item.context as string) ?? null,
    metrics: (item.metrics as string) ?? null,
    skills: (item.skills as string[]) ?? [],
    strength: item.strength as number,
  }));

  const context = buildPrepContext({
    conversations,
    round: group
      ? {
          label: (group.label as string) ?? null,
          roundNumber: (group.round_number as number) ?? null,
          notes: (group.notes as string) ?? null,
        }
      : null,
    role: {
      title: role.title,
      seniority: role.seniority,
      location: role.location,
      workMode: role.work_mode,
      jdText: role.jd_text,
      requirements: role.requirements,
      requirementMatches: role.requirement_matches,
    },
    company: {
      name: company.name,
      industry: company.industry,
      stage: company.stage,
      headcountBand: company.headcount_band,
      research: company.research,
      priority: company.priority,
    },
    priorRounds: ((priorRows ?? []) as unknown as PrepPriorJoin[]).map((row) => ({
      id: row.id,
      roleTitle: row.applications?.roles?.title ?? null,
      kind: row.kind,
      scheduledAt: row.scheduled_at,
      questionsAsked: row.questions_asked ?? [],
      notes: row.notes,
    })),
    bank: items,
    profile: {
      targetTitles: (profile?.target_titles as string[]) ?? [],
      timezone: (profile?.timezone as string) ?? 'UTC',
      writingStyleNotes: (profile?.writing_style_notes as string) ?? null,
    },
  });

  // The round's earliest conversation carries the note for the whole round.
  const leadId = context.round.conversations[0]?.id ?? parsed.data.interviewId;
  const key = prepKey({
    jdHash: role.jd_hash,
    bank: items,
    conversations: context.round.conversations,
    contactIds: context.interviewers.map((person) => person.contactId),
  });

  const { data: stored, error: storedError } = await supabase
    .from('interviews')
    .select('prep_note, prep_note_key')
    .eq('id', leadId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (storedError) return fail(storedError.message);

  if (!parsed.data.regenerate && stored?.prep_note && stored.prep_note_key === key) {
    return { note: stored.prep_note as PrepNote, error: null, roleId: application.role_id, spent: false, spend: [] };
  }

  const spend: SpendReport[] = [];
  const result = await writePrepNote(
    { apiKey, onSpend: (report) => spend.push(report) },
    { context, banned: (profile?.banned_constructions as string[]) ?? [] },
  );
  // A run was made whether or not it produced a note, so the caller records it.
  if (!result.ok) return { ...fail(result.error, application.role_id), spent: spend.length > 0, spend };

  const { error: writeError } = await supabase
    .from('interviews')
    .update({
      prep_note: result.note,
      prep_note_at: new Date().toISOString(),
      prep_note_key: key,
    })
    .eq('id', leadId)
    .eq('user_id', user.id);

  if (writeError) return { ...fail(writeError.message, application.role_id), spent: true, spend };

  return { note: result.note, error: null, roleId: application.role_id, spent: true, spend };
}
