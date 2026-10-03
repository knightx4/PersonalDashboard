/**
 * What happens when a comment on a role is addressed to Dash (note 89ad8bef).
 *
 * Read the role, its description, the requirement map, the evidence bank and
 * the thread; ask; file any cover letter into the application; write the
 * reply into the thread as `claude`.
 *
 * The same rule as lib/goals/ask.ts: every outcome is written into the
 * thread, including the ones where nothing could be done, because a question
 * that went nowhere silently looks the same as one being worked on.
 *
 * A letter filed into the application is recorded in core.dash_actions with
 * the application as it was before and after (plan #1459), so it can be
 * undone while nobody has edited the letter since.
 */
import 'server-only';

import { readSubjectOrNull, recordDashAction, type DashActionDeps } from '@/lib/core/dash-actions';
import { toRef } from '@/lib/core/refs';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { recordSessionSpend } from '@/lib/core/spend/session';
import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import type { RequirementMatch } from '@/lib/jobs/evidence/match-payload';
import { askRoleReplyModel } from './model';
import { parseRoleReply, renderBank, replyBody, roleReplyMessage, type Turn } from './reply';

export type RoleAskInput = {
  client: AppSupabaseClient;
  userId: string;
  roleId: string;
  /** The comment carrying the question, left out of the history. */
  commentId: string;
  question: string;
  apiKey: string | null;
  /** The person's clients, for recording the letter in core.dash_actions. */
  dash: DashActionDeps;
};

export type RoleAskOutcome = { ok: true; message: string } | { ok: false; error: string };

async function say(input: RoleAskInput, body: string): Promise<void> {
  const { error } = await input.client.from('notes').insert({
    user_id: input.userId,
    role_id: input.roleId,
    author: 'claude',
    body,
  });
  if (error) throw new Error(error.message);
}

export async function askDashOnRole(input: RoleAskInput): Promise<RoleAskOutcome> {
  try {
    return await produceReply(input);
  } catch (error) {
    const why =
      'Something went wrong on the way to a reply: ' +
      `${error instanceof Error ? error.message : 'no reason given'}. Your comment is saved.`;
    try {
      await say(input, why);
    } catch {
      /* the action's own message is the only copy left */
    }
    return { ok: false, error: why };
  }
}

async function produceReply(input: RoleAskInput): Promise<RoleAskOutcome> {
  const refuse = async (why: string): Promise<RoleAskOutcome> => {
    await say(input, why);
    return { ok: false, error: why };
  };

  const { client, userId, roleId } = input;
  const [
    { data: role, error: roleError },
    { data: application },
    { data: bank },
    { data: profile },
    { data: notes },
  ] = await Promise.all([
    client
      .from('roles')
      .select(
        'id, title, seniority, location, work_mode, jd_text, requirement_matches, companies!inner ( name, industry, stage, research )',
      )
      .eq('id', roleId)
      .eq('user_id', userId)
      .maybeSingle(),
    // The latest attempt, which is the one the role page shows.
    client
      .from('applications')
      .select('id, status, cover_letter')
      .eq('role_id', roleId)
      .eq('user_id', userId)
      .order('attempt', { ascending: false })
      .limit(1)
      .maybeSingle(),
    client.from('evidence_items').select('id, title, body, context, metrics').eq('user_id', userId),
    client
      .from('profiles')
      .select('writing_style_notes, banned_constructions')
      .eq('id', userId)
      .maybeSingle(),
    client
      .from('notes')
      .select('id, author, body, created_at')
      .eq('role_id', roleId)
      .eq('user_id', userId)
      .order('created_at', { ascending: true }),
  ]);

  if (roleError) throw new Error(roleError.message);
  if (!role) return { ok: false, error: 'That role is no longer here, so nothing was asked.' };
  if (!application)
    return refuse('This role has no application to answer about. Your comment is saved.');

  if (!input.apiKey) {
    return refuse(
      'No ANTHROPIC_API_KEY on the deployment, so I cannot answer. Your comment is saved.',
    );
  }

  const company = role.companies as unknown as {
    name: string;
    industry: string | null;
    stage: string | null;
    research: string | null;
  };
  const banned = (profile?.banned_constructions as string[] | null) ?? [];
  const items = (bank ?? []).map((item) => ({
    id: item.id as string,
    title: item.title as string,
    body: item.body as string,
    context: (item.context as string | null) ?? null,
    metrics: (item.metrics as string | null) ?? null,
  }));
  const rendered = renderBank(items);
  const history: Turn[] = (notes ?? [])
    .filter((note) => note.id !== input.commentId)
    .map((note) => ({
      author: note.author === 'claude' ? 'claude' : 'me',
      body: note.body as string,
    }));
  const coverLetter = (application.cover_letter as string | null) ?? null;

  const message = roleReplyMessage(
    {
      role: {
        title: role.title as string,
        seniority: (role.seniority as string | null) ?? null,
        location: (role.location as string | null) ?? null,
        workMode: (role.work_mode as string | null) ?? null,
        jdText: (role.jd_text as string | null) ?? null,
      },
      company,
      application: { status: application.status as string, coverLetter },
      matches: ((role.requirement_matches as RequirementMatch[] | null) ?? []).map((match) => ({
        requirement: match.requirement,
        kind: match.kind,
        verdict: match.verdict,
        evidenceItemId: match.evidenceItemId,
      })),
      bank: items,
      profile: {
        writingStyleNotes: (profile?.writing_style_notes as string | null) ?? null,
        banned,
      },
    },
    history,
    input.question,
    rendered.refs,
  );

  const spend: SpendReport[] = [];
  const asked = await askRoleReplyModel(
    { apiKey: input.apiKey, onSpend: (report) => spend.push(report) },
    { bank: rendered.text, message },
  );
  await recordSessionSpend(userId, { module: 'jobs', operation: 'reply-to-role-comment' }, spend);
  if (!asked.ok)
    return refuse(`I could not produce a reply: ${asked.error} Your comment is saved.`);

  const reply = parseRoleReply(asked.input, rendered.refs, banned);
  if (reply.kind === 'error')
    return refuse(`I could not produce a reply: ${reply.error} Your comment is saved.`);

  if (reply.coverLetter) {
    const ref = toRef('job_search.applications', application.id as string);
    const before = await readSubjectOrNull(input.dash, ref);
    const { error } = await client
      .from('applications')
      .update({ cover_letter: reply.coverLetter })
      .eq('id', application.id as string)
      .eq('user_id', userId);
    if (error) return refuse(`I wrote a letter but could not save it: ${error.message}`);
    await recordDashAction(input.dash, {
      surface: 'thread',
      kind: 'write_cover_letter',
      subjectRef: ref,
      op: 'update',
      beforeValues: before,
      summary: `${coverLetter?.trim() ? 'Rewrote' : 'Wrote'} the cover letter for ${role.title as string} at ${company.name}.`,
    });
  }

  await say(input, replyBody(reply, coverLetter));
  return {
    ok: true,
    message: reply.coverLetter
      ? 'Cover letter written, under Application.'
      : 'Answered in the thread.',
  };
}
