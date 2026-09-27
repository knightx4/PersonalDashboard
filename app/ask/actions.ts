'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { estimatePaidActions, type PaidCosts } from '@/lib/core/spend/paid-actions';
import {
  askDashInRequest,
  listAskConversations,
  loadAskConversation,
} from '@/lib/talk/ask-request';
import type { AskDashResult } from '@/lib/talk/ask';
import type { ConversationSummary } from '@/lib/talk/store';
import type { TalkTurn } from '@/lib/talk/talk';

/**
 * Asking Dash from the sheet in the shell and from /ask (plan #1090).
 *
 * The work is lib/talk/ask-request.ts; these are the doors a browser can
 * call. The conversation ref is checked as a uuid before anything is read,
 * since it arrives from the page, and whose conversation it is decides RLS.
 */

const Ref = z.string().uuid();

/**
 * Ask a question, or carry on the conversation `conversationRef` names. Never
 * throws: a failure comes back as `error`, and the question is kept whenever
 * it could be. Takes up to about twenty seconds.
 */
// latency: pending
export async function askDashQuestion(
  question: string,
  conversationRef: string | null,
): Promise<AskDashResult> {
  if (typeof question !== 'string') return { turns: [], error: 'Write a question first.' };
  let ref: string | null = null;
  if (conversationRef != null) {
    const parsed = Ref.safeParse(conversationRef);
    if (!parsed.success) return { turns: [], error: 'That conversation is not there any more.' };
    ref = parsed.data;
  }
  try {
    const result = await askDashInRequest({ question, conversationRef: ref });
    // The list of past questions reads the table, so a new question or a new
    // answer has to show there the next time it is opened.
    if (result.conversation) revalidatePath('/ask');
    return result;
  } catch {
    return { turns: [], error: 'Dash could not be asked. Check your connection and try again.' };
  }
}

/** The last few questions, for the sheet's list of earlier ones. */
// latency: pending
export async function recentAskQuestions(): Promise<{
  conversations: ConversationSummary[];
  error?: string;
}> {
  try {
    return { conversations: await listAskConversations(5) };
  } catch {
    return { conversations: [], error: 'Your earlier questions could not be read.' };
  }
}

/** One earlier question's turns, to reopen it in the sheet. */
// latency: pending
export async function openAskQuestion(ref: string): Promise<{ turns: TalkTurn[]; error?: string }> {
  const parsed = Ref.safeParse(ref);
  if (!parsed.success) return { turns: [], error: 'That conversation is not there any more.' };
  try {
    const turns = await loadAskConversation(parsed.data);
    return turns.length > 0 ? { turns } : { turns, error: 'That conversation is not there any more.' };
  } catch {
    return { turns: [], error: 'That conversation could not be read. Try again.' };
  }
}

/**
 * The $ figure for asking. The sheet lives in the shell, under no module's
 * layout, so it asks for its one figure when it opens, the way the capture
 * panel does.
 */
// latency: pending
export async function askDashCosts(): Promise<PaidCosts> {
  const user = await requireUser();
  try {
    const core = await createCoreClient();
    return await estimatePaidActions(core, user.id, ['app/ask/actions.ts#askDashQuestion']);
  } catch {
    return {};
  }
}
