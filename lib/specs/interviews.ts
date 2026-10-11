import type { SupabaseClient } from '@supabase/supabase-js';
import type { CommentAuthor, DevComment } from '@/lib/comments/load';
import { isModuleId } from '@/lib/modules';
import { addThreadTurn, loadThread, loadThreads, rowRef } from '@/lib/thread/store';
import { APP_VISION, type VisionScope } from './vision';

/**
 * Interviews Dash holds to draft a workspace's vision and spec (plan #1638,
 * feature #1637), stored in `spec_interviews` (supabase/migrations/0181).
 *
 * One row per interview, for a workspace or for the app as a whole. The
 * questions and answers are the thread under the row, in core.conversations
 * under `public.spec_interviews:<id>`: Dash's questions as 'claude' turns and
 * the person's answers as 'me' turns, read back oldest first. Every function
 * here takes the account's id and touches only that account's interviews, so
 * a service-role client is as safe to pass as the person's own.
 *
 * Starting an interview for a workspace that already has an open one returns
 * that one, so starting again is how an interview is resumed. The database
 * holds one open interview per workspace (spec_interviews_one_open_uq).
 *
 * Not `server-only`, like vision-review.ts: the drafting run may write through
 * a script outside Next.
 */

export type SpecInterviewStatus = 'open' | 'drafted' | 'abandoned';

/** The most questions an interview asks unless the setting says otherwise. */
export const DEFAULT_QUESTION_LIMIT = 12;
/** The range the database allows for the limit. */
export const MIN_QUESTION_LIMIT = 1;
export const MAX_QUESTION_LIMIT = 30;

export const SPEC_INTERVIEWS_TABLE = 'public.spec_interviews';

/** One question Dash asked and the answer it got, if any yet. */
export type InterviewExchange = {
  question: DevComment;
  answer: DevComment | null;
};

export type SpecInterview = {
  id: string;
  module: VisionScope;
  status: SpecInterviewStatus;
  questionLimit: number;
  draftRequestedAt: string | null;
  summary: string | null;
  visionReviewId: string | null;
  specChangeId: string | null;
  startedAt: string;
  finishedAt: string | null;
  /** Every turn of the thread, oldest first. */
  turns: DevComment[];
};

const COLUMNS =
  'id, module, status, question_limit, draft_requested_at, summary, vision_review_id, spec_change_id, started_at, finished_at';

type Row = {
  id: string;
  module: string;
  status: SpecInterviewStatus;
  question_limit: number;
  draft_requested_at: string | null;
  summary: string | null;
  vision_review_id: string | null;
  spec_change_id: string | null;
  started_at: string;
  finished_at: string | null;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>;

/** The ref the interview's thread is kept under. */
export function interviewRef(id: string): string {
  return rowRef(SPEC_INTERVIEWS_TABLE, id);
}

/** Whether an interview can be held for this key: a workspace, or 'app'. */
export function isInterviewScope(value: string): value is VisionScope {
  return value === APP_VISION || isModuleId(value);
}

/** The limit to store: a whole number in range, or the default. */
export function clampQuestionLimit(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_QUESTION_LIMIT;
  return Math.min(MAX_QUESTION_LIMIT, Math.max(MIN_QUESTION_LIMIT, Math.round(value)));
}

function fromRow(row: Row, turns: DevComment[]): SpecInterview {
  return {
    id: row.id,
    module: row.module as VisionScope,
    status: row.status,
    questionLimit: row.question_limit,
    draftRequestedAt: row.draft_requested_at,
    summary: row.summary,
    visionReviewId: row.vision_review_id,
    specChangeId: row.spec_change_id,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    turns,
  };
}

/**
 * The thread as questions and answers, in the order they were asked. Each
 * 'claude' turn starts an exchange and the person's turns after it, up to
 * the next question, are its answer, joined when there is more than one. A
 * turn of the person's before any question (an opening note) is left out.
 */
export function interviewExchanges(turns: readonly DevComment[]): InterviewExchange[] {
  const exchanges: InterviewExchange[] = [];
  for (const turn of turns) {
    if (turn.author === 'claude') {
      exchanges.push({ question: turn, answer: null });
      continue;
    }
    const current = exchanges[exchanges.length - 1];
    if (!current) continue;
    current.answer = current.answer
      ? { ...current.answer, body: `${current.answer.body}\n\n${turn.body}` }
      : turn;
  }
  return exchanges;
}

/** How many questions Dash has asked so far. */
export function questionsAsked(interview: Pick<SpecInterview, 'turns'>): number {
  return interview.turns.filter((turn) => turn.author === 'claude').length;
}

/**
 * Whose move it is in an open interview: Dash's when nothing has been asked or
 * the last question has an answer, the person's when a question is waiting.
 * Null once the interview has finished or a draft has been asked for.
 */
export function nextMove(interview: SpecInterview): 'ask' | 'answer' | 'draft' | null {
  if (interview.status !== 'open') return null;
  if (interview.draftRequestedAt) return 'draft';
  const last = interview.turns[interview.turns.length - 1];
  if (last && last.author === 'claude') return 'answer';
  return questionsAsked(interview) >= interview.questionLimit ? 'draft' : 'ask';
}

async function readRow(client: AnyClient, userId: string, id: string): Promise<Row | null> {
  const { data, error } = await client
    .from('spec_interviews')
    .select(COLUMNS)
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(`Reading the interview failed: ${error.message}`);
  return (data as Row | null) ?? null;
}

/** One interview with its thread, or null when it is not the account's. */
export async function loadSpecInterview(
  client: AnyClient,
  userId: string,
  id: string,
): Promise<SpecInterview | null> {
  const row = await readRow(client, userId, id);
  if (!row) return null;
  return fromRow(row, await loadThread(client, interviewRef(row.id), { userId }));
}

/** The open interview for a workspace, with its thread, or null. */
export async function loadOpenSpecInterview(
  client: AnyClient,
  userId: string,
  module: VisionScope,
): Promise<SpecInterview | null> {
  const { data, error } = await client
    .from('spec_interviews')
    .select(COLUMNS)
    .eq('user_id', userId)
    .eq('module', module)
    .eq('status', 'open')
    .maybeSingle();
  if (error) throw new Error(`Reading the interview failed: ${error.message}`);
  const row = data as Row | null;
  if (!row) return null;
  return fromRow(row, await loadThread(client, interviewRef(row.id), { userId }));
}

/** Every interview of the account's, newest first, with their threads. */
export async function loadSpecInterviews(
  client: AnyClient,
  userId: string,
  options: { module?: VisionScope } = {},
): Promise<SpecInterview[]> {
  let query = client.from('spec_interviews').select(COLUMNS).eq('user_id', userId);
  if (options.module) query = query.eq('module', options.module);
  const { data, error } = await query.order('started_at', { ascending: false });
  if (error) throw new Error(`Reading the interviews failed: ${error.message}`);
  const rows = (data ?? []) as Row[];
  const threads = await loadThreads(
    client,
    rows.map((row) => interviewRef(row.id)),
    { userId },
  );
  return rows.map((row) => fromRow(row, threads.get(interviewRef(row.id)) ?? []));
}

/**
 * Start an interview for a workspace, or pick up the one already open there.
 * `resumed` says which. The limit applies only to a new interview.
 */
export async function startSpecInterview(
  client: AnyClient,
  userId: string,
  module: string,
  options: { questionLimit?: number } = {},
): Promise<{ interview: SpecInterview; resumed: boolean }> {
  if (!isInterviewScope(module)) throw new Error(`There is no workspace called ${module}.`);
  const open = await loadOpenSpecInterview(client, userId, module);
  if (open) return { interview: open, resumed: true };

  const { data, error } = await client
    .from('spec_interviews')
    .insert({ user_id: userId, module, question_limit: clampQuestionLimit(options.questionLimit) })
    .select(COLUMNS)
    .single();
  if (error) {
    // Another tab started one at the same moment: resume that.
    if (/spec_interviews_one_open_uq/.test(error.message)) {
      const raced = await loadOpenSpecInterview(client, userId, module);
      if (raced) return { interview: raced, resumed: true };
    }
    throw new Error(`Starting the interview failed: ${error.message}`);
  }
  return { interview: fromRow(data as Row, []), resumed: false };
}

/**
 * Add a question (author 'claude') or an answer ('me') to an open interview
 * of the account's, returning the turn's id. Refuses an interview that is not
 * theirs or has finished.
 */
export async function addInterviewTurn(
  client: AnyClient,
  userId: string,
  input: { interviewId: string; author: CommentAuthor; body: string },
): Promise<string> {
  const body = input.body.trim();
  if (!body) throw new Error('There is nothing to keep.');
  const row = await readRow(client, userId, input.interviewId);
  if (!row) throw new Error('That interview is not one of yours, or it is no longer there.');
  if (row.status !== 'open') throw new Error('That interview has finished.');
  return addThreadTurn(client, { userId, ref: interviewRef(row.id), author: input.author, body });
}

/** Mark an open interview as ready to draft ("draft it now"). */
export async function requestInterviewDraft(client: AnyClient, userId: string, id: string): Promise<void> {
  const { data, error } = await client
    .from('spec_interviews')
    .update({ draft_requested_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', userId)
    .eq('status', 'open')
    .is('draft_requested_at', null)
    .select('id');
  if (error) throw new Error(`Asking for the drafts failed: ${error.message}`);
  if ((data ?? []).length === 0) {
    const row = await readRow(client, userId, id);
    if (!row) throw new Error('That interview is not one of yours, or it is no longer there.');
    if (row.status !== 'open') throw new Error('That interview has finished.');
  }
}

/**
 * Finish an open interview: 'drafted' with what it drafted and a summary of
 * what the person said, or 'abandoned' with neither.
 */
export async function finishSpecInterview(
  client: AnyClient,
  userId: string,
  id: string,
  outcome:
    | { status: 'drafted'; summary: string; visionReviewId: string | null; specChangeId: string | null }
    | { status: 'abandoned' },
): Promise<void> {
  const fields =
    outcome.status === 'drafted'
      ? {
          status: 'drafted' as const,
          summary: outcome.summary.trim() || null,
          vision_review_id: outcome.visionReviewId,
          spec_change_id: outcome.specChangeId,
        }
      : { status: 'abandoned' as const };
  const { data, error } = await client
    .from('spec_interviews')
    .update({ ...fields, finished_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', userId)
    .eq('status', 'open')
    .select('id');
  if (error) throw new Error(`Finishing the interview failed: ${error.message}`);
  if ((data ?? []).length === 0) throw new Error('That interview is not one of yours, or it has already finished.');
}
