import 'server-only';

import { requireUser } from '@/lib/auth/server';
import { confirmChange, declineChange, undoChange, type ChangeDeps, type ChangeOutcome } from '@/lib/ask/changes';
import { executeProposal } from '@/lib/ask/propose';
import { executeAskTool } from '@/lib/ask/tools';
import { requestAskDb } from '@/lib/ask/clients';
import { resolvePage, type PageContext } from '@/lib/ask/page';
import { isAskPath } from '@/lib/ask/page-name';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { createCoreClient } from '@/lib/core/auth/server';
import { createGoalsClient } from '@/lib/goals/auth/server';
import { recordSpendReports } from '@/lib/core/spend/record';
import { todayInTimezone } from '@/lib/money';
import { allSearchSources } from '@/lib/search/registry';
import { createTask } from '@/lib/todo/tasks/write';
import { searchMail } from '@/lib/inbox/search-mail';
import { readMail } from '@/lib/inbox/read-mail';
import { dashBackupRoutine, fireFeatureRoutine } from '@/lib/feedback/routine';
import { handoffBrief } from './handoff';
import { attachHandoffs, discardHandoffs, insertHandoff, loadOpenHandoffs, markHandoffFired } from './handoffs';
import { askDash, type AskDashResult } from './ask';
import {
  attachProposals,
  discardProposals,
  insertProposal,
  loadChanges,
  loadMadeChanges,
  type DashChange,
  type MadeChange,
} from './changes';
import { appendTurns, listConversations, loadConversation, startAsk, type ConversationSummary } from './store';
import type { TalkTurn } from './talk';

/**
 * Asking Dash from a request (plan #1089): the signed-in person, their
 * workspaces and timezone, their own clients for every lookup and for the
 * conversation. Only works inside a request, since every client reads the
 * cookies. A server action or route handler calls these; plan #1090 is the
 * page that does.
 */

/**
 * Ask a question, or continue the `ask` conversation `conversationRef` names.
 * Never throws for a failed answer: the result carries the error, and the
 * question is kept either way. Takes up to about twenty seconds.
 */
export async function askDashInRequest(input: {
  question: string;
  conversationRef?: string | null;
  /** The app address it was asked from, already checked; null when dropped. */
  page?: string | null;
}): Promise<AskDashResult> {
  const user = await requireUser();
  const [settings, core] = await Promise.all([loadAccountSettings(user.id), createCoreClient()]);
  const today = todayInTimezone(settings.timezone);
  const ctx = askContext(user.id, settings);

  const page = input.page ? await pageFor(ctx, input.page) : null;
  // Dash is offered the hand-off only when the backup routine can be started.
  const backup = dashBackupRoutine();
  const canHandOff = Boolean(backup.id && backup.token);

  return askDash(
    {
      question: input.question,
      conversationRef: input.conversationRef,
      page,
      today,
      execute: (name, args) => executeAskTool(name, args, ctx),
      propose: (name, args, seen, save) =>
        executeProposal(name, args, { ...ctx, seen, save, timezone: settings.timezone }),
      anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    },
    {
      start: (question) => startAsk(core, user.id, question),
      load: (ref) => loadConversation(core, { kind: 'ask', ref }),
      append: (subject, turns) => appendTurns(core, user.id, subject, turns),
      recordSpend: (reports) =>
        recordSpendReports(core, user.id, { module: 'core', operation: 'ask-dash' }, reports),
      saveProposal: (conversationId, change) => insertProposal(core, user.id, conversationId, change),
      attachProposals: (ids, turnId) => attachProposals(core, ids, turnId),
      discardProposals: (ids) => discardProposals(core, ids),
      ...(canHandOff
        ? {
            saveHandoff: (conversationId: string, request: string) =>
              insertHandoff(core, user.id, conversationId, request),
            attachHandoffs: (ids: readonly string[], turnId: string) => attachHandoffs(core, ids, turnId),
            discardHandoffs: (ids: readonly string[]) => discardHandoffs(core, ids),
            fireHandoff: async (handoff) => {
              const fired = await fireFeatureRoutine({
                apiKey: backup.token,
                routineId: backup.id,
                text: handoffBrief(handoff, user.id),
              });
              const status = await markHandoffFired(core, handoff.id, fired);
              return fired.ok ? { status } : { status, error: fired.error };
            },
          }
        : {}),
    },
  );
}

/**
 * The page a question was asked from, resolved (plan #1271). The Ask page is
 * where earlier questions are carried on, so being on it says nothing about
 * the question and no page is told.
 */
async function pageFor(ctx: Parameters<typeof resolvePage>[0], address: string): Promise<PageContext | null> {
  if (isAskPath(address)) return null;
  try {
    return await resolvePage(ctx, address);
  } catch {
    return null;
  }
}

/**
 * What the sheet shows as the page Dash will be told (plan #1272): the row's
 * title when the page shows one of theirs, the page's name otherwise, and
 * null on the Ask page or when it could not be worked out.
 */
export async function askPageLabel(address: string): Promise<string | null> {
  const user = await requireUser();
  const settings = await loadAccountSettings(user.id);
  const page = await pageFor(askContext(user.id, settings), address);
  return page ? (page.row?.title ?? page.page) : null;
}

/** Everything a lookup needs, as the signed-in person. */
function askContext(
  userId: string,
  settings: Awaited<ReturnType<typeof loadAccountSettings>>,
): Parameters<typeof resolvePage>[0] {
  return {
    userId,
    today: todayInTimezone(settings.timezone),
    timezone: settings.timezone,
    enabledModules: settings.enabledModules,
    db: requestAskDb(),
    searchSources: allSearchSources(),
    // Gmail as it is now, through the person's own mailboxes; nothing is kept.
    searchMail: async (search) => searchMail(await createCoreClient(), userId, search),
    readMail: async (message) => readMail(await createCoreClient(), userId, message),
  };
}

/** The person's past questions, most recently added to first. */
export async function listAskConversations(limit = 50): Promise<ConversationSummary[]> {
  await requireUser();
  return listConversations(await createCoreClient(), 'ask', limit);
}

/** One past question's turns, oldest first, with each answer's lookups and citations; empty when it is not theirs or not there. */
export async function loadAskConversation(ref: string): Promise<TalkTurn[]> {
  await requireUser();
  return loadConversation(await createCoreClient(), { kind: 'ask', ref });
}

/**
 * How many requests in one past question are still with the backup routine
 * (plan #1402): the thread keeps checking for its reply while any are.
 */
export async function countOpenAskHandoffs(ref: string): Promise<number> {
  await requireUser();
  return (await loadOpenHandoffs(await createCoreClient(), ref)).length;
}

/**
 * The changes Dash proposed in one past question, in the order proposed, each
 * with its turn and what became of it; empty when it is not theirs or not there.
 */
export async function loadAskChanges(ref: string): Promise<DashChange[]> {
  await requireUser();
  return loadChanges(await createCoreClient(), ref);
}

/**
 * Every change the person confirmed through Dash, newest first, whether it
 * still stands or was undone (plan #1191), each with the question it came from.
 */
export async function loadAskMadeChanges(limit = 200): Promise<MadeChange[]> {
  await requireUser();
  return loadMadeChanges(await createCoreClient(), limit);
}

/**
 * What confirming, declining and undoing a change needs (plan #1189): the
 * signed-in person, their settings, and their own clients, so every write
 * goes through row level security as theirs.
 */
async function changeDeps(): Promise<ChangeDeps> {
  const user = await requireUser();
  const [settings, core] = await Promise.all([loadAccountSettings(user.id), createCoreClient()]);
  return {
    userId: user.id,
    timezone: settings.timezone,
    today: todayInTimezone(settings.timezone),
    enabledModules: settings.enabledModules,
    core,
    db: requestAskDb(),
    goals: (history) => createGoalsClient(history),
    createTask,
  };
}

/** Write a proposed change and mark it confirmed, or say why not. */
export async function confirmAskChange(id: string): Promise<ChangeOutcome> {
  return confirmChange(await changeDeps(), id);
}

/** Mark a proposed change declined, or say why not. */
export async function declineAskChange(id: string): Promise<ChangeOutcome> {
  return declineChange(await changeDeps(), id);
}

/** Take a confirmed change back and mark it undone, or say why not. */
export async function undoAskChange(id: string): Promise<ChangeOutcome> {
  return undoChange(await changeDeps(), id);
}
