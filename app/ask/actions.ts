'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { estimatePaidActions, type PaidCosts } from '@/lib/core/spend/paid-actions';
import { changePaths, type ChangeOutcome } from '@/lib/ask/changes';
import {
  askDashInRequest,
  askPageLabel,
  confirmAskChange,
  countOpenAskHandoffs,
  declineAskChange,
  listAskConversations,
  loadAskChanges,
  loadAskConversation,
  undoAskChange,
} from '@/lib/talk/ask-request';
import type { AskDashResult } from '@/lib/talk/ask';
import type { DashChange } from '@/lib/talk/changes';
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
 * An address in the app, as the sheet's pathname gives it: starts with one
 * slash (so not `//host`), bounded, one line. Anything else is dropped rather
 * than refused, since the question still stands without it.
 */
const PagePath = z
  .string()
  .max(500)
  .regex(/^\/(?!\/)[^\s]*$/);

/**
 * Ask a question, or carry on the conversation `conversationRef` names. Never
 * throws: a failure comes back as `error`, and the question is kept whenever
 * it could be. Takes up to about a minute (TIME_BUDGET_MS). `page` is the app
 * address it was asked from (plan #1271); null when there is none or it was
 * dropped.
 */
// latency: pending
export async function askDashQuestion(
  question: string,
  conversationRef: string | null,
  page: string | null = null,
): Promise<AskDashResult> {
  if (typeof question !== 'string') return { turns: [], error: 'Write a question first.' };
  let ref: string | null = null;
  if (conversationRef != null) {
    const parsed = Ref.safeParse(conversationRef);
    if (!parsed.success) return { turns: [], error: 'That conversation is not there any more.' };
    ref = parsed.data;
  }
  try {
    const onPage = page == null ? null : PagePath.safeParse(page);
    const result = await askDashInRequest({
      question,
      conversationRef: ref,
      page: onPage?.success ? onPage.data : null,
    });
    // The list of past questions reads the table, so a new question or a new
    // answer has to show there the next time it is opened.
    if (result.conversation) revalidatePath('/ask');
    return result;
  } catch {
    return { turns: [], error: 'Dash could not be asked. Check your connection and try again.' };
  }
}

/**
 * The page the sheet is open over, named for its chip (plan #1272): the
 * row's title, or the page's name. Null on the Ask page, for an address that
 * is not one, and on any failure, when the sheet keeps its own rough name.
 */
// latency: pending
export async function askDashPageLabel(page: string): Promise<string | null> {
  const parsed = PagePath.safeParse(page);
  if (!parsed.success) return null;
  try {
    return await askPageLabel(parsed.data);
  } catch {
    return null;
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

/** An earlier question reopened: its turns, and the changes Dash proposed in it. */
export type OpenedAsk = {
  turns: TalkTurn[];
  /** Oldest first, each tied to its answer by turnId (plan #1190). */
  changes: DashChange[];
  error?: string;
  /** Set when the turns were read and the changes were not. */
  changesError?: string;
  /** Requests handed to the backup routine with no reply yet (plan #1402). */
  openHandoffs?: number;
};

/** One earlier question's turns and changes, to reopen it in the sheet. */
// latency: pending
export async function openAskQuestion(ref: string): Promise<OpenedAsk> {
  const parsed = Ref.safeParse(ref);
  if (!parsed.success) return { turns: [], changes: [], error: 'That conversation is not there any more.' };
  try {
    const [turns, changes] = await Promise.all([
      loadAskConversation(parsed.data),
      loadAskChanges(parsed.data).then(
        (found) => ({ found }),
        (error: unknown) => {
          console.error('ask changes were not read', error);
          return { found: [] as DashChange[], failed: true };
        },
      ),
    ]);
    if (turns.length === 0) return { turns, changes: [], error: 'That conversation is not there any more.' };
    const openHandoffs = await countOpenAskHandoffs(parsed.data).catch(() => 0);
    return 'failed' in changes
      ? { turns, changes: [], changesError: CHANGES_UNREAD, openHandoffs }
      : { turns, changes: changes.found, openHandoffs };
  } catch {
    return { turns: [], changes: [], error: 'That conversation could not be read. Try again.' };
  }
}

/**
 * A thread waiting on the backup routine checks back with this (plan #1402):
 * the conversation's turns as they now stand, and how many hand-offs are
 * still open. Never throws; a failed read says nothing is open, which stops
 * the checking until the thread is reopened.
 */
// latency: pending
export async function pollAskQuestion(ref: string): Promise<{ turns: TalkTurn[]; open: number }> {
  const parsed = Ref.safeParse(ref);
  if (!parsed.success) return { turns: [], open: 0 };
  try {
    const [turns, open] = await Promise.all([loadAskConversation(parsed.data), countOpenAskHandoffs(parsed.data)]);
    return { turns, open };
  } catch {
    return { turns: [], open: 0 };
  }
}

/** Said above a reopened thread whose changes could not be read. */
const CHANGES_UNREAD = 'The changes Dash proposed here could not be read, so their cards are missing. Reopen it to try again.';

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

/**
 * Confirm, decline or undo one change Dash proposed (plan #1189). Each takes
 * the change's id and never throws: the result is the change as it now
 * stands, or a sentence saying why not, with the change as it stands when it
 * could be read. Confirm and undo revalidate the pages the change lands on,
 * and all three the Ask page, whose list of changes reads the table.
 */
async function pressChange(
  id: string,
  press: (id: string) => Promise<ChangeOutcome>,
  failed: string,
): Promise<ChangeOutcome> {
  const parsed = Ref.safeParse(id);
  if (!parsed.success) return { ok: false, error: 'That change is not there any more.', change: null };
  try {
    const outcome = await press(parsed.data);
    if (outcome.ok) {
      if (outcome.change.status !== 'declined') {
        for (const path of changePaths(outcome.change)) revalidatePath(path);
      }
      revalidatePath('/ask');
    }
    return outcome;
  } catch (error) {
    console.error('ask change failed', error);
    return { ok: false, error: failed, change: null };
  }
}

// latency: pending
export async function confirmDashChange(id: string): Promise<ChangeOutcome> {
  return pressChange(id, confirmAskChange, 'The change could not be written. Check your connection and try again.');
}

// latency: pending
export async function declineDashChange(id: string): Promise<ChangeOutcome> {
  return pressChange(id, declineAskChange, 'The change could not be declined. Try again.');
}

// latency: pending
export async function undoDashChange(id: string): Promise<ChangeOutcome> {
  return pressChange(id, undoAskChange, 'The change could not be undone. Check your connection and try again.');
}
