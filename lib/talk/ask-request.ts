import 'server-only';

import { requireUser } from '@/lib/auth/server';
import { executeProposal } from '@/lib/ask/propose';
import { executeAskTool } from '@/lib/ask/tools';
import { requestAskDb } from '@/lib/ask/clients';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { createCoreClient } from '@/lib/core/auth/server';
import { recordSpendReports } from '@/lib/core/spend/record';
import { todayInTimezone } from '@/lib/money';
import { allSearchSources } from '@/lib/search/registry';
import { askDash, type AskDashResult } from './ask';
import { attachProposals, discardProposals, insertProposal, loadChanges, type DashChange } from './changes';
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
}): Promise<AskDashResult> {
  const user = await requireUser();
  const [settings, core] = await Promise.all([loadAccountSettings(user.id), createCoreClient()]);
  const today = todayInTimezone(settings.timezone);
  const ctx = {
    userId: user.id,
    today,
    enabledModules: settings.enabledModules,
    db: requestAskDb(),
    searchSources: allSearchSources(),
  };

  return askDash(
    {
      question: input.question,
      conversationRef: input.conversationRef,
      today,
      execute: (name, args) => executeAskTool(name, args, ctx),
      propose: (name, args, seen, save) => executeProposal(name, args, { ...ctx, seen, save }),
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
    },
  );
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
 * The changes Dash proposed in one past question, in the order proposed, each
 * with its turn and what became of it; empty when it is not theirs or not there.
 */
export async function loadAskChanges(ref: string): Promise<DashChange[]> {
  await requireUser();
  return loadChanges(await createCoreClient(), ref);
}
