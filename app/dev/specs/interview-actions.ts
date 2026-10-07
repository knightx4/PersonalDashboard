'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/auth/server';
import { requireOwner } from '@/lib/dev/owner';
import { loadAccountSettings } from '@/lib/core/account/settings';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { recordSessionSpend } from '@/lib/core/spend/session';
import { serverEnv } from '@/lib/env';
import { todayInTimezone } from '@/lib/money';
import { asksForDraft } from '@/lib/dash/interview';
import {
  finishSpecInterview,
  interviewExchanges,
  isInterviewScope,
  loadSpecInterview,
  nextMove,
  requestInterviewDraft,
  startSpecInterview,
} from '@/lib/specs/interviews';
import { answerInterview, askInterviewQuestion, draftInterview } from '@/lib/specs/interview-run';

/**
 * The interview on the specs page (plan #1641): start one for a workspace or
 * the app, answer Dash's questions one at a time, and have Dash draft the
 * vision and a spec from the answers.
 *
 * Every move ends with the page read again, so the card draws the interview
 * as it is stored rather than as the press left it. A question takes one
 * model call of a few seconds; the draft takes one or two, up to about a
 * minute, inside the page's maxDuration. What they spend is recorded under
 * core 'ask-dash', Dash's own loop.
 */

export type InterviewActionState = {
  error?: string;
  /** The answer that did not go in, handed back to the box. */
  body?: string;
};

const SPECS_PATH = '/dev/specs';

const NO_KEY = 'ANTHROPIC_API_KEY is not set on the server, so Dash cannot ask or draft.';

const NOT_YOURS = 'That interview is not one of yours, or it is no longer there.';

async function context() {
  const supabase = await createClient();
  const user = await requireOwner({ supabase });
  const settings = await loadAccountSettings(user.id);
  const reports: SpendReport[] = [];
  const deps = {
    anthropicApiKey: serverEnv().ANTHROPIC_API_KEY ?? '',
    today: todayInTimezone(settings.timezone),
    onSpend: (report: SpendReport) => void reports.push(report),
  };
  const record = () => recordSessionSpend(user.id, { module: 'core', operation: 'ask-dash' }, reports);
  return { supabase, user, deps, record };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Interview me, and Ask the next question: starts an interview for the
 * workspace, or picks up the one open there, and has Dash ask when it is
 * Dash's move.
 */
// latency: pending -- Dash writes the question before the card can show it
export async function startInterview(
  _prev: InterviewActionState,
  formData: FormData,
): Promise<InterviewActionState> {
  const scope = String(formData.get('module') ?? '');
  if (!isInterviewScope(scope)) return { error: 'That is not a workspace.' };
  const { supabase, user, deps, record } = await context();
  if (!deps.anthropicApiKey) return { error: NO_KEY };
  try {
    const { interview } = await startSpecInterview(supabase, user.id, scope);
    const asked = await askInterviewQuestion(supabase, user.id, interview.id, deps);
    if (asked.kind === 'failed') return { error: asked.detail };
    return {};
  } catch (error) {
    return { error: message(error) };
  } finally {
    await record();
    revalidatePath(SPECS_PATH);
  }
}

/**
 * Send, and Draft it now. An answer is kept and the next question asked; once
 * the questions run out, or the person asks for the draft (the button, or
 * typing "draft it now"), Dash drafts the vision and the spec. An answer typed
 * in the box when Draft it now is pressed is kept first.
 */
// latency: pending -- the reply is Dash's next question, or the drafts
export async function answerInterviewQuestion(
  _prev: InterviewActionState,
  formData: FormData,
): Promise<InterviewActionState> {
  const id = String(formData.get('id') ?? '');
  const body = String(formData.get('body') ?? '').trim();
  const wantsDraft = formData.get('intent') === 'draft' || asksForDraft(body);
  const answer = asksForDraft(body) ? '' : body;
  if (!id) return { error: NOT_YOURS };
  if (!wantsDraft && !answer) return { error: 'Write an answer first.' };

  const { supabase, user, deps, record } = await context();
  if (!deps.anthropicApiKey) return { error: NO_KEY, body };
  try {
    let interview = await loadSpecInterview(supabase, user.id, id);
    if (!interview) return { error: NOT_YOURS, body };
    if (interview.status !== 'open') return {};

    if (answer) interview = await answerInterview(supabase, user.id, id, answer);
    if (wantsDraft) {
      if (!interviewExchanges(interview.turns).some((exchange) => exchange.answer)) {
        return { error: 'Answer at least one question before Dash drafts.', body };
      }
      await requestInterviewDraft(supabase, user.id, id);
    }

    const after = await loadSpecInterview(supabase, user.id, id);
    let move = after ? nextMove(after) : null;
    if (move === 'ask') {
      // An answer that leaves questions to ask: Dash asks the next.
      const asked = await askInterviewQuestion(supabase, user.id, id, deps);
      if (asked.kind === 'failed') return { error: asked.detail };
      if (asked.kind === 'question') return {};
      move = asked.move;
    }
    if (move !== 'draft') return {};

    const drafted = await draftInterview(supabase, user.id, id, deps);
    if (drafted.kind === 'failed') return { error: drafted.detail };
    return {};
  } catch (error) {
    return { error: message(error), body };
  } finally {
    await record();
    revalidatePath(SPECS_PATH);
  }
}

/** Stop: ends an interview without drafting anything. */
// latency: pending
export async function stopInterview(
  _prev: InterviewActionState,
  formData: FormData,
): Promise<InterviewActionState> {
  const id = String(formData.get('id') ?? '');
  const supabase = await createClient();
  const user = await requireOwner({ supabase });
  try {
    await finishSpecInterview(supabase, user.id, id, { status: 'abandoned' });
  } catch (error) {
    return { error: message(error) };
  }
  revalidatePath(SPECS_PATH);
  return {};
}
