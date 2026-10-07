import 'server-only';

import type Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SpendSink } from '@/lib/core/spend/pricing';
import {
  asksForDraft,
  nextInterviewQuestion,
  type InterviewBackground,
  type InterviewNote,
  type InterviewQuestion,
} from '@/lib/dash/interview';
import { MODULES, moduleForPath } from '@/lib/modules';
import {
  addInterviewTurn,
  loadSpecInterview,
  nextMove,
  requestInterviewDraft,
  type SpecInterview,
} from './interviews';
import { readSpec, SPECS } from './registry';
import { APP_VISION, type VisionScope } from './vision';

/**
 * The interview's two moves as a server action makes them (plan #1639): Dash
 * asking its next question, and the person answering. Each reads the
 * interview fresh and checks whose move it is, so a double press or a second
 * tab cannot ask twice or answer a question that was never asked.
 *
 * The model call is lib/dash/interview.ts on the shared Dash loop. What it
 * spends is handed to `onSpend`; the caller records it under the core
 * operation 'ask-dash', since this is Dash's loop answering what the person
 * typed and adds no conversational model path of its own.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>;

/** How far back the notes and the page opens are read. */
export const BACKGROUND_DAYS = 90;
/** The most notes the brief lists. */
export const BACKGROUND_NOTES = 12;
/** The most notes read to find them, newest first, before sorting by workspace. */
const NOTES_SCANNED = 300;

const DAY_MS = 24 * 60 * 60 * 1000;

/** "Job search", or "the app as a whole". */
export function scopeLabel(scope: VisionScope): string {
  if (scope === APP_VISION) return 'the app as a whole';
  return MODULES.find((module) => module.id === scope)?.label ?? scope;
}

/**
 * What is already written about a workspace: its vision, its specs (the text
 * for a workspace's own, the blurb for the app's, which run long and are about
 * how the app is built), recent notes filed on its pages, and its page opens.
 * A part that cannot be read is left out rather than failing the question.
 */
export async function loadInterviewBackground(
  client: AnyClient,
  userId: string,
  scope: VisionScope,
  now: number = Date.now(),
): Promise<InterviewBackground> {
  const since = new Date(now - BACKGROUND_DAYS * DAY_MS).toISOString();
  const isApp = scope === APP_VISION;
  const specDocs = SPECS.filter((spec) => (isApp ? spec.module === null : spec.module === scope));

  const [vision, notes, opens, specs] = await Promise.all([
    client
      .from('module_visions')
      .select('body')
      .eq('user_id', userId)
      .eq('module', scope)
      .maybeSingle()
      .then(({ data }) => ((data as { body: string } | null)?.body ?? null)),
    client
      .from('feedback_items')
      .select('kind, body, page_path, created_at')
      .eq('user_id', userId)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(NOTES_SCANNED)
      .then(({ data, error }) => {
        if (error) return [];
        return ((data ?? []) as { kind: string; body: string; page_path: string | null; created_at: string }[])
          .filter((row) => (moduleForPath(row.page_path) ?? APP_VISION) === scope)
          .slice(0, BACKGROUND_NOTES)
          .map((row): InterviewNote => ({
            kind: row.kind,
            body: row.body,
            pagePath: row.page_path,
            createdAt: row.created_at,
          }));
      }),
    readOpens(client, userId, scope, since),
    Promise.all(
      specDocs.map(async (spec) => ({
        title: spec.title,
        text: isApp ? spec.blurb : ((await readSpec(spec)) ?? spec.blurb),
      })),
    ),
  ]);

  return { label: scopeLabel(scope), vision, specs, notes, opens };
}

async function readOpens(
  client: AnyClient,
  userId: string,
  scope: VisionScope,
  since: string,
): Promise<InterviewBackground['opens']> {
  try {
    const core = client.schema('core');
    const [counted, first] = await Promise.all([
      core.rpc('workspace_opens', { p_user_id: userId, p_since: since }),
      core.from('page_view_days').select('day').eq('user_id', userId).limit(1),
    ]);
    if (counted.error) return null;
    const rows = (counted.data ?? []) as { workspace: string | null; opens: number; pages: number }[];
    const mine = rows.find((row) => (row.workspace ?? APP_VISION) === scope);
    const recorded = rows.length > 0 || (first.data ?? []).length > 0;
    return { days: BACKGROUND_DAYS, opens: mine?.opens ?? 0, pages: mine?.pages ?? 0, recorded };
  } catch {
    return null;
  }
}

/** What asking came to, with the new turn's id when a question was kept. */
export type AskedInterviewQuestion =
  | (Extract<InterviewQuestion, { kind: 'question' }> & { turnId: string })
  | Exclude<InterviewQuestion, { kind: 'question' }>;

/**
 * Dash's next question in an interview of the account's, kept in its thread.
 * Asks nothing when it is not Dash's move: after the last question allowed,
 * after "draft it now", or while a question waits for its answer.
 */
export async function askInterviewQuestion(
  client: AnyClient,
  userId: string,
  interviewId: string,
  deps: {
    anthropicApiKey: string;
    /** YYYY-MM-DD in the person's timezone. */
    today: string;
    onSpend?: SpendSink;
    anthropic?: Anthropic;
  },
): Promise<AskedInterviewQuestion> {
  const interview = await loadSpecInterview(client, userId, interviewId);
  if (!interview) return { kind: 'failed', detail: 'That interview is not one of yours, or it is no longer there.' };
  const move = nextMove(interview);
  if (move !== 'ask') return { kind: 'stop', move };

  const background = await loadInterviewBackground(client, userId, interview.module);
  const asked = await nextInterviewQuestion({
    interview,
    background,
    today: deps.today,
    anthropicApiKey: deps.anthropicApiKey,
    client: deps.anthropic,
    onSpend: deps.onSpend,
  });
  if (asked.kind !== 'question') return asked;
  const turnId = await addInterviewTurn(client, userId, {
    interviewId,
    author: 'claude',
    body: asked.question,
  });
  return { ...asked, turnId };
}

/**
 * The person's answer to the question waiting in an interview of theirs. An
 * answer that only asks for the draft ("draft it now") asks for it instead of
 * being kept. Returns the interview as it now stands, whose nextMove says
 * what happens next: 'ask' for another question, 'draft' once the questions
 * have ended.
 */
export async function answerInterview(
  client: AnyClient,
  userId: string,
  interviewId: string,
  body: string,
): Promise<SpecInterview> {
  const interview = await loadSpecInterview(client, userId, interviewId);
  if (!interview) throw new Error('That interview is not one of yours, or it is no longer there.');
  if (asksForDraft(body)) {
    await requestInterviewDraft(client, userId, interviewId);
  } else {
    if (nextMove(interview) !== 'answer') throw new Error('There is no question waiting for an answer.');
    await addInterviewTurn(client, userId, { interviewId, author: 'me', body });
  }
  const after = await loadSpecInterview(client, userId, interviewId);
  if (!after) throw new Error('That interview is no longer there.');
  return after;
}
