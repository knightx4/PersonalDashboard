/**
 * What happens when a comment on a role is addressed to Dash (note 89ad8bef).
 *
 * Read the role, its description, the requirement map, the evidence bank and
 * the thread; reply through the shared loop (lib/dash/thread.ts, plan #1465)
 * with Ask Dash's lookups and writes, so "@dash remind me to follow up on
 * Friday" adds the todo; file any cover letter into the application through
 * the role's own tool, write_cover_letter; write the reply into the thread
 * as `claude`.
 *
 * The same rule as lib/goals/ask.ts: every outcome is written into the
 * thread, including the ones where nothing could be done, because a question
 * that went nowhere silently looks the same as one being worked on.
 *
 * A letter filed into the application is recorded in core.dash_actions with
 * the application as it was before and after (plan #1459), so it can be
 * undone while nobody has edited the letter since. Every other write is
 * recorded under the comment that asked for it (plan #1518), so Home's list
 * of what Dash did links back to the role.
 */
import 'server-only';

import { readSubjectOrNull, recordDashAction, type DashActionDeps } from '@/lib/core/dash-actions';
import { toRef } from '@/lib/core/refs';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { recordSessionSpend } from '@/lib/core/spend/session';
import type Anthropic from '@anthropic-ai/sdk';
import { DASH_MODELS } from '@/lib/dash/models';
import { replyInThread, subjectLine, threadVoice, type ThreadDash } from '@/lib/dash/thread';
import { ROLE_THREAD_TABLE } from '@/lib/dash/thread-tools';
import { addThreadTurn, loadThread, threadCause } from '@/lib/thread/store';
import type { DashThreadActs } from '@/lib/dash/registry';
import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import type { RequirementMatch } from '@/lib/jobs/evidence/match-payload';
import { parseRoleReply, renderBank, replyBody, roleReplyMessage, type Turn } from './reply';

/** The model a role reply is written with: Sonnet, since a letter goes out under their name. */
export const ROLE_REPLY_MODEL = DASH_MODELS.roleThread;

/** What a reply on a role is told, after the rules every thread shares. */
const ROLE_RULES = `THIS THREAD IS ON A ROLE in their job search. The message gives the role:
its description, how their record was matched against its requirements, the
cover letter on file if there is one, how they write, and the conversation on
it so far. Their evidence bank follows these rules, each item with a ref like
e1. A question about the role, the company, their fit, what to say or what to
do next is answered from that.

WRITING THE COVER LETTER. When the comment asks for a cover letter, or asks to
change the one on file ("make it shorter", "lead with the migration work"),
call write_cover_letter with the whole letter: the full text they would send,
not a diff and not an outline. It replaces the letter on file, so a change to
an existing letter keeps everything they did not ask to change. List the bank
refs it draws on in evidence_refs, and in unsupported_claims every factual
claim in it that no bank item carries (a number, a scale, a title, a result),
copied as it appears in the letter. Then say in one sentence what you did.

How the letter is written:

Every claim of substance traces to a bank item. You are arranging their
material for this role, not adding to it. Where the role wants something the
bank does not show, leave it out or name it plainly; never invent it.

Their words, not yours. Reuse the vocabulary and rhythm of the items you
cite, and follow the notes on how they write. A letter that reads better
than they write is one they have to rewrite.

Short: three or four paragraphs, under 350 words unless they ask otherwise.
Open with why this role, from the description, not with who they are. Pick
two or three pieces of evidence that answer the requirements marked must
have. No paragraph about how exciting the opportunity is, no closing
paragraph about enthusiasm, and no sign-off beyond their first name if the
thread gives it.`;

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
  /** The person's lookups and writes, for the shared loop (threadDashInRequest). */
  dashThread: ThreadDash;
  /** For tests: the model client. */
  anthropic?: Anthropic;
};

export type RoleAskOutcome = { ok: true; message: string } | { ok: false; error: string };

async function say(input: RoleAskInput, body: string): Promise<void> {
  await addThreadTurn(input.client, {
    userId: input.userId,
    ref: toRef(ROLE_THREAD_TABLE, input.roleId),
    author: 'claude',
    body,
  });
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
    // The role's thread, from the shared store (plan #1470).
    loadThread(client, toRef(ROLE_THREAD_TABLE, roleId), { userId }).then((data) => ({ data })),
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
  const subjectRef = toRef(ROLE_THREAD_TABLE, roleId);

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

  // The comment is what every write is recorded under, so Home can say the
  // todo came from this role's thread (plan #1518).
  const cause = await threadCause(client, { userId, turnId: input.commentId });

  // The one thing only this thread can do: file a letter into the application.
  let letterWritten = false;
  const writeLetter = async (args: unknown): ReturnType<DashThreadActs> => {
    const raw = args && typeof args === 'object' ? (args as Record<string, unknown>) : {};
    const parsed = parseRoleReply({ ...raw, answer: '' }, rendered.refs, banned);
    if (parsed.kind === 'error') return { ok: false, error: parsed.error };
    if (!parsed.coverLetter) return { ok: false, error: 'The letter was empty, so nothing was filed.' };
    const ref = toRef('job_search.applications', application.id as string);
    const before = await readSubjectOrNull(input.dash, ref);
    const { error } = await client
      .from('applications')
      .update({ cover_letter: parsed.coverLetter })
      .eq('id', application.id as string)
      .eq('user_id', userId);
    if (error) return { ok: false, error: `The letter could not be saved: ${error.message}` };
    await recordDashAction(input.dash, {
      surface: 'thread',
      kind: 'write_cover_letter',
      subjectRef: ref,
      op: 'update',
      beforeValues: before,
      cause,
      summary: `${coverLetter?.trim() ? 'Rewrote' : 'Wrote'} the cover letter for ${role.title as string} at ${company.name}.`,
    });
    letterWritten = true;
    return { ok: true, recorded: true, kind: 'write_cover_letter', said: replyBody(parsed, coverLetter) };
  };

  const spend: SpendReport[] = [];
  const reply = await replyInThread({
    voice: threadVoice(
      ROLE_REPLY_MODEL,
      `${ROLE_RULES}\n\n${rendered.text ? `The evidence bank:\n\n${rendered.text}` : 'The evidence bank is empty. There is nothing to cite.'}`,
      ROLE_THREAD_TABLE,
    ),
    subject: { ref: subjectRef, title: role.title as string },
    message: `${subjectLine(subjectRef)}\n\n${message}`,
    dash: input.dashThread,
    acts: async (name, args) =>
      name === 'write_cover_letter' ? writeLetter(args) : { ok: false, error: 'That cannot be done on a role.' },
    cause,
    anthropicApiKey: input.apiKey,
    client: input.anthropic,
    onSpend: (report) => spend.push(report),
  });
  await recordSessionSpend(userId, { module: 'jobs', operation: 'reply-to-role-comment' }, spend);
  if (!reply.ok) return refuse(`I could not produce a reply: ${reply.detail} Your comment is saved.`);

  await say(input, reply.body);
  return {
    ok: true,
    message: letterWritten
      ? 'Cover letter written, under Application.'
      : reply.made.length > 0
        ? 'Done, and said in the thread.'
        : 'Answered in the thread.',
  };
}
