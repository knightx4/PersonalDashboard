import 'server-only';

import { appRoutePortInRequest } from '@/lib/dash/app-route-port';
import { createClient, requireUser } from '@/lib/auth/server';
import {
  confirmChange,
  declineChange,
  reopenChange,
  undoChange,
  writeChange,
  type ChangeDeps,
  type ChangeOutcome,
} from '@/lib/ask/changes';
import { readSubject } from '@/lib/core/dash-actions';
import { executeProposal } from '@/lib/ask/propose';
import { estimatePaidActions } from '@/lib/core/spend/paid-actions';
import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import { queuePaidPress, type PaidEstimator } from '@/lib/dash/paid';
import { dashTool, type DashPaidTool } from '@/lib/dash/registry';
import { executeAskTool, lookupInScope } from '@/lib/ask/tools';
import { HIT_TABLES } from '@/lib/ask/lookups';
import type { ModuleId } from '@/lib/modules';
import type { AskMention } from './ask-input';
import { requestAskDb } from '@/lib/ask/clients';
import { resolvePage, type PageContext } from '@/lib/ask/page';
import { resolveFilteredList } from '@/lib/ask/filtered-list';
import { ASK_LISTS, type AskListFilter } from '@/lib/ask/list-filter';
import { isAskPath } from '@/lib/ask/page-name';
import { loadAccountSettings } from '@/lib/core/account/settings';
import type { UploadedAttachment } from '@/lib/attachments/rules';
import { rateAnswer, type AnswerRating, type RateAnswerOutcome } from './rate-answer';
import { createCoreClient } from '@/lib/core/auth/server';
import { createGoalsClient } from '@/lib/goals/auth/server';
import { isOwner } from '@/lib/dev/owner';
import { brokerRoutine, goalsRoutine } from '@/lib/feedback/routine';
import { startSessionThread } from '@/lib/core/session-threads';
import { wakeBroker } from '@/lib/threads/broker-wake';
import { createCoreServiceSupabase } from '@/inngest/core/supabase-admin';
import { THINK_FALLBACK } from './thought';
import { askTitle } from './talk';
import { chatAsMessage } from './chat-to-session';
import { recordSpendReports } from '@/lib/core/spend/record';
import { todayInTimezone } from '@/lib/money';
import { allSearchSources } from '@/lib/search/registry';
import { createTask } from '@/lib/todo/tasks/write';
import { fileVaultNote, sessionInboxPorts, undoVaultCapture } from '@/lib/capture/vault';
import { searchMail } from '@/lib/inbox/search-mail';
import { readJobBoard } from '@/lib/jobs/discover/read-board';
import { lookUpPlaces } from '@/lib/you/places-lookup';
import { createYouClient } from '@/lib/you/auth/server';
import { readMail } from '@/lib/inbox/read-mail';
import type { SessionHandoffInput } from './handoff';
import { fireSessionHandoff } from './handoff-fire';
import {
  askHandoffOf,
  attachHandoffs,
  discardHandoffs,
  handoffStatusOf,
  keepSessionHandoff,
  loadOpenHandoffs,
  type SessionHandoff,
} from './handoffs';
import { canHandToSession } from './session-handoff-store';
import { botPasser } from './hand-to-bot-store';
import { askDash, type AskDashResult, type AskLookupEvent, type AskStores } from '@/lib/dash/ask';
import { keepFailure, lastFailureSwitches } from '@/lib/dash/failures';
import { keepSlip } from '@/lib/dash/slips';
import { codeDeps } from '@/lib/dash/think-code';
import { devAccess } from '@/lib/ask/dev';
import { dashModelFor } from '@/lib/dash/model-choice';
import type { ThreadDash } from '@/lib/dash/thread';
import type { PeopleDash } from '@/lib/you/people-actions';
import {
  attachProposals,
  discardProposals,
  insertMadeChange,
  insertPeopleChange,
  insertPeopleProposal,
  insertProposal,
  insertThreadProposal,
  loadChanges,
  loadMadeChanges,
  type DashChange,
  type MadeChange,
} from './changes';
import {
  amendAnswerBody,
  appendTurns,
  editAskChat,
  listAskChats,
  listConversations,
  loadAskChatMeta,
  loadConversation,
  searchAskChats,
  startAsk,
  type AskChatEdit,
  type AskChatHit,
  type ConversationSummary,
} from './store';
import type { AskChat } from './ask-chats';
import { chatCostMicros, chatSpan } from './chat-trail';
import { RECALL_OPERATION } from '@/lib/memory/search';
import type { TalkCitation, TalkTurn } from './talk';
import { keepTurnMadeFiles, readTurnFiles, recordTurnFiles, withTurnFiles } from './turn-files';
import { saveAnswer, type SaveAnswerOutcome, type SaveAnswerTo } from './save-answer';
import { markAnswered, markAnswering, markFailed, readReply, requestStop, stopRequested } from './reply-state-store';
import { replyStateOf, type ReplyState } from './reply-state';

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
 * question is kept either way. Usually takes a few seconds, and up to about a
 * minute for a question that needs several lookups (TIME_BUDGET_MS).
 */
export async function askDashInRequest(input: {
  question: string;
  conversationRef?: string | null;
  /** The app address it was asked from, already checked; null when dropped. */
  page?: string | null;
  /** Files uploaded with the question, already checked (parseAskInput). */
  files?: readonly UploadedAttachment[];
  /**
   * The filter a list was under when the person sent it with the question
   * (plan #1658), already checked. Its rows are read again here and told to
   * Dash as the ones "these" means.
   */
  list?: AskListFilter | null;
  /** Hears each lookup as it starts and finishes (plan #1438): the streaming route listens. */
  onLookup?: (event: AskLookupEvent) => void;
  /** Hears the answer's text as it is written (plan #1902): the streaming route listens. */
  onText?: (piece: string) => void;
  /** Hears the question once it is kept (plan #1899.5): the streaming route tells the browser. */
  onAsked?: Parameters<typeof askDash>[0]['onAsked'];
  /** Aborts when the person stops the answer (plan #1899.5); what was written is kept. */
  signal?: AbortSignal;
  /** Rows added with @, already checked (parseAskMentions). */
  mentions?: readonly AskMention[];
  /** The workspace the lookups are kept to, already checked; null for every one. */
  scope?: ModuleId | null;
  /** "Think it through" was on (plan #2789.10). */
  think?: boolean;
  /** Try again (plan #2854.4): answer the chat's last question, which has none, instead of adding one. */
  retry?: boolean;
}): Promise<AskDashResult> {
  const user = await requireUser();
  const [settings, core] = await Promise.all([loadAccountSettings(user.id), createCoreClient()]);
  // The model the person chose for their questions (plan #2458.2); Sonnet when none.
  const choosing = dashModelFor(core, user.id);
  const today = todayInTimezone(settings.timezone);
  const ctx = askContext(user.id, settings);

  const list = input.list ? await resolveFilteredList(ctx, input.list) : null;
  // The sent list is on a page of its own, which Dash is told even when the
  // person left the page out of the question.
  const where = input.page ?? (list ? ASK_LISTS[list.list].path : null);
  const asked = where ? await pageFor(ctx, where) : null;
  const page = asked && list ? { ...asked, list } : asked;
  // Dash is offered the hand-off only when the backup routine can be started.
  const canHandOff = canHandToSession();
  // The session rows this answer kept, so each is started from its own row.
  const keptSessions = new Map<string, SessionHandoff>();
  // A question kept to one workspace (plan #1899.5) looks only there: its
  // lookups run as though that were the only workspace switched on, and
  // one outside it is refused. Writes and the page keep the full context.
  // Try again asks with the switches the failed answer was asked with
  // (plan #2937.2): a reload leaves Think it through off and no workspace
  // picked, and the question deserves the same answer it was asked for.
  const before = input.retry && input.conversationRef ? await lastFailureSwitches(core, user.id, input.conversationRef) : null;
  const think = Boolean(input.think || before?.think);
  const asScope = input.scope ?? (before?.scope as ModuleId | null | undefined) ?? null;
  const scope = asScope && settings.enabledModules.includes(asScope) ? asScope : null;
  const lookIn = scope ? { ...ctx, enabledModules: [scope] } : ctx;
  // Think it through goes to a session thread on this app (plan #2789.11)
  // when the broker can be woken. Sessions work on the owner's repository and
  // the broker reads the owner's threads alone, so another account is
  // answered here as before, with nothing said.
  const sessions = think ? await thinkInSession(core, user.id, input.question) : null;
  // Passing a request to a bot on People (plan #3003.2), for the owner alone, as People offers it.
  const passToBot = (await isOwner()) ? botPasser(await createYouClient(), core, user.id) : null;

  // Where the reply stands is kept on the chat (plan #2854.4), so a thread
  // opened after the page that asked has gone shows Dash still writing, or
  // the reply failed with Try again. Stop is read from the chat too: leaving
  // the page no longer ends the answer, and Stop may reach another function.
  const stopping = new AbortController();
  if (input.signal?.aborted) stopping.abort();
  else input.signal?.addEventListener('abort', () => stopping.abort(), { once: true });
  let started: Promise<{ ref: string; at: string } | null> = Promise.resolve(null);
  let watch: ReturnType<typeof setInterval> | null = null;
  const onAsked: NonNullable<typeof input.onAsked> = (asked) => {
    const ref = asked.conversation.ref;
    started = markAnswering(core, user.id, ref).then(
      (at) => ({ ref, at }),
      (error: unknown) => {
        console.error('the reply was not marked as being written', error);
        return null;
      },
    );
    void started.then((mark) => {
      if (!mark || stopping.signal.aborted) return;
      watch = setInterval(() => {
        void stopRequested(core, user.id, ref, mark.at).then((stop) => {
          if (stop) stopping.abort();
        });
      }, STOP_POLL_MS);
    });
    input.onAsked?.(asked);
  };

  const result = await askDash(
    {
      question: input.question,
      conversationRef: input.conversationRef,
      retry: input.retry,
      files: input.files,
      page,
      today,
      execute: (name, args) =>
        scope && !lookupInScope(name, scope)
          ? Promise.resolve({ ok: false as const, error: 'That lookup is outside the workspace this question is kept to.' })
          : executeAskTool(name, args, lookIn),
      propose: (name, args, seen, save) =>
        executeProposal(name, args, { ...ctx, seen, save, timezone: settings.timezone }),
      // A write runs as the person, through their own clients (plan #1440).
      write: (tool, args, seen, conversationId) =>
        tool.apply(
          {
            ...ctx,
            seen,
            goals: (history) => createGoalsClient(history),
            createTask,
            quickNotePorts: () => sessionInboxPorts(user.id),
            goalRoutine: goalRoutineInRequest,
            appRoute: appRoutePortInRequest(user.id, { conversationId }),
            origin: { kind: 'ask_dash', ref: conversationId },
            slipWhere: { surface: 'ask', conversation: `ask:${conversationId}`, href: `/chat/dash/${conversationId}` },
          },
          args,
        ),
      // A paid press is checked and priced as the person, and only queued (plan #2228.1).
      queue: (tool, args, seen) =>
        queuePaidPress(tool, args, { ...ctx, seen }, paidEstimator(core, user.id)),
      anthropicApiKey: process.env.ANTHROPIC_API_KEY,
      onLookup: input.onLookup,
      onText: input.onText,
      onAsked,
      signal: stopping.signal,
      mentions: mentionCitations(input.mentions ?? []),
      scope,
      model: await choosing,
      // The code is read as the owner, as Dev is (plan #2789.10).
      think: think ? { ...codeDeps(), codeAccess: () => devAccess(ctx) } : null,
      thinkFallback: sessions?.fallback ?? null,
    },
    {
      start: (question) => startAsk(core, user.id, question),
      load: async (ref) => withTurnFiles(core, await loadConversation(core, { kind: 'ask', ref })),
      append: async (subject, turns) =>
        recordTurnFiles(core, user.id, turns, await appendTurns(core, user.id, subject, turns)),
      readFiles: (turnId) => readTurnFiles(core, turnId),
      // What the answer's code made is kept under it (plan #3050.3.2).
      keepFiles: (turnId, files) => keepTurnMadeFiles(core, user.id, turnId, files),
      amendAnswer: (turnId, body) => amendAnswerBody(core, user.id, turnId, body),
      recordSpend: (reports) =>
        recordSpendReports(core, user.id, { module: 'core', operation: 'ask-dash' }, reports),
      recordFailure: (failure) => keepFailure(core, user.id, failure),
      recordSlip: (slip) => keepSlip(core, user.id, slip),
      ...(sessions?.toSession ? { toSession: sessions.toSession } : {}),
      ...(passToBot ? { passToBot } : {}),
      saveProposal: (conversationId, change) => insertProposal(core, user.id, conversationId, change),
      saveChange: (conversationId, made) => insertMadeChange(core, user.id, conversationId, made),
      attachProposals: (ids, turnId) => attachProposals(core, ids, turnId),
      discardProposals: (ids) => discardProposals(core, ids),
      noteGap: async (body, conversationRef) => {
        try {
          const supabase = await createClient();
          const { error } = await supabase
            .from('feedback_items')
            .insert({ user_id: user.id, kind: 'feature', body, page_path: `/chat/dash/${conversationRef}` });
          if (error) console.error('the gap note was not filed', error.message);
        } catch (error) {
          console.error('the gap note was not filed', error);
        }
      },
      ...(canHandOff
        ? {
            // One session row per question (plan #3005.2), read as Ask's hand-off.
            saveHandoff: async (handoff: SessionHandoffInput) => {
              const kept = await keepSessionHandoff(core, user.id, handoff);
              if (!kept.ok) return kept;
              keptSessions.set(kept.handoff.id, kept.handoff);
              return { ok: true as const, handoff: askHandoffOf(kept.handoff), created: kept.created };
            },
            attachHandoffs: (ids: readonly string[], turnId: string) => attachHandoffs(core, ids, turnId),
            discardHandoffs: (ids: readonly string[]) => discardHandoffs(core, ids),
            // Started as People's are, with the session brief (plan #3005.3).
            fireHandoff: async (handoff) => {
              const kept = keptSessions.get(handoff.id);
              if (!kept) return { status: 'failed' as const, error: 'the request was not found to pass on.' };
              const started = await fireSessionHandoff(core, user.id, kept);
              const status = handoffStatusOf(started.state);
              return started.error ? { status, error: started.error } : { status };
            },
          }
        : {}),
    },
  );
  if (watch) clearInterval(watch);
  const mark = await started;
  if (mark) {
    try {
      if (result.error) await markFailed(core, user.id, mark.ref, result.error);
      else await markAnswered(core, user.id, mark.ref);
    } catch (error) {
      console.error('where the reply stands was not kept', error);
    }
  }
  return result;
}

/**
 * How a thought-through question reaches a session thread (plan #2789.11):
 * the store that starts the thread and wakes the broker, or why it is
 * answered here instead. Null for an account that is not the owner's.
 */
async function thinkInSession(
  core: CoreSupabaseClient,
  userId: string,
  question: string,
): Promise<{ toSession?: NonNullable<AskStores['toSession']>; fallback?: string } | null> {
  if (!(await isOwner())) return null;
  const routine = brokerRoutine();
  // wakeBroker never fires without both, so the thread would sit unanswered.
  if (!routine.id || !routine.token) return { fallback: THINK_FALLBACK.noBroker };
  return {
    toSession: async (conversation) => {
      const text = chatAsMessage(conversation, { think: true });
      if (!text) return { ok: false, error: 'The chat had no words to send.' };
      const { id } = await startSessionThread(
        core,
        userId,
        { projectId: null, text, file: null, mode: 'think', title: askTitle(question) || question },
        [],
      );
      const woken = await wakeBroker({ core: createCoreServiceSupabase(), userId, threadId: id, routine });
      if (!woken.ok) console.error('the session broker was not woken for a thought-through question', woken.error);
      return { ok: true, threadId: id };
    },
  };
}

/** How often a reply being written checks whether Stop was pressed (plan #2854.4). */
const STOP_POLL_MS = 1_000;

/** The rows added with @ as the question keeps them: an answer's citation shape, by search's tables. */
export function mentionCitations(mentions: readonly AskMention[]): TalkCitation[] {
  return mentions.map((m) => ({ table: HIT_TABLES[m.kind], ref: m.id, title: m.title, href: m.href }));
}

/**
 * Whether the signed-in person may start the goals routine, and the routine
 * it is fired at: the owner's account only, as the goal page's Ask Dash
 * (app/goals/[goalId]/shaping-actions.ts). Only inside a request.
 */
async function goalRoutineInRequest() {
  return { canRun: await isOwner(), routine: goalsRoutine() };
}

/**
 * What a thread needs to reply through the shared loop (plan #1465): the
 * signed-in person's lookups, their writes through their own clients, and
 * where a write's record is kept (core.dash_actions, surface 'thread').
 * Only inside a request.
 */
export async function threadDashInRequest(userId: string): Promise<ThreadDash> {
  const [settings, core] = await Promise.all([loadAccountSettings(userId), createCoreClient()]);
  const ctx = askContext(userId, settings);
  return {
    today: todayInTimezone(settings.timezone),
    execute: (name, args) => executeAskTool(name, args, ctx),
    apply: (tool, args, seen, acts) =>
      tool.apply(
        {
          ...ctx,
          seen,
          goals: (history) => createGoalsClient(history),
          createTask,
          quickNotePorts: () => sessionInboxPorts(userId),
          goalRoutine: goalRoutineInRequest,
          appRoute: appRoutePortInRequest(userId, null),
          // A question handed to a goal from a thread is answered on the page it was asked on.
          origin: { kind: 'goal_page', ref: null },
          thread: acts,
        },
        args,
      ),
    saveChange: (made, cause) => insertMadeChange(core, userId, cause, made),
    queue: (tool, args, seen) => queuePaidPress(tool, args, { ...ctx, seen }, paidEstimator(core, userId)),
    saveProposal: (change, cause) => insertThreadProposal(core, userId, cause, change),
    recordFailure: (failure) => keepFailure(core, userId, failure),
  };
}

/**
 * What the people on People act with (plan #2854.2): Ask's lookups, writes,
 * proposals and paid presses as the signed-in person, each kept in
 * core.dash_actions naming the person on People who made it and the thread.
 * Only inside a request, or `after` one, while its cookies are still read.
 */
export async function peopleDashInRequest(userId: string): Promise<PeopleDash & Pick<ThreadDash, 'today' | 'execute'>> {
  const [settings, core] = await Promise.all([loadAccountSettings(userId), createCoreClient()]);
  const ctx = askContext(userId, settings);
  return {
    today: todayInTimezone(settings.timezone),
    execute: (name, args) => executeAskTool(name, args, ctx),
    apply: (tool, args, seen, cause) =>
      tool.apply(
        {
          ...ctx,
          seen,
          goals: (history) => createGoalsClient(history),
          createTask,
          quickNotePorts: () => sessionInboxPorts(userId),
          goalRoutine: goalRoutineInRequest,
          // A route run from People says its finish in that thread, as the bot (plan #3070.3).
          appRoute: appRoutePortInRequest(userId, cause ? { advisorChatId: cause.chatId, advisorId: cause.advisorId } : null),
          // A question handed to a goal from a People thread is answered from Chat.
          origin: { kind: 'chat', ref: null },
          slipWhere: {
            surface: 'people',
            conversation: cause ? `people:${cause.chatId}` : null,
            href: cause?.href ?? null,
          },
        },
        args,
      ),
    recordSlip: (slip) => keepSlip(core, userId, slip),
    saveChange: (made, cause) => insertPeopleChange(core, userId, cause, made),
    propose: (name, args, seen, save) => executeProposal(name, args, { ...ctx, seen, save, timezone: settings.timezone }),
    queue: (tool, args, seen) => queuePaidPress(tool, args, { ...ctx, seen }, paidEstimator(core, userId)),
    saveProposal: (change, cause) => insertPeopleProposal(core, userId, cause, change),
  };
}

/** Prices a paid press by its button's key, as its $ hint does, against the person's own ledger. */
function paidEstimator(core: CoreSupabaseClient, userId: string): PaidEstimator {
  return async (action) => (await estimatePaidActions(core, userId, [action]))[action] ?? null;
}

/** The paid tool of that name in Dash's registry, for an approval to run (plan #2228.1). */
function paidToolNamed(name: string): DashPaidTool | undefined {
  const tool = dashTool(name);
  return tool?.kind === 'paid' ? tool : undefined;
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
    readJobBoard,
    // Google Places near home, under the app's daily cap (plan #2987.3).
    findPlaces: async (search) =>
      lookUpPlaces({ you: await createYouClient(), core: await createCoreClient(), userId }, search),
  };
}

/** The person's past questions, most recently added to first. */
export async function listAskConversations(limit = 50): Promise<ConversationSummary[]> {
  await requireUser();
  return listConversations(await createCoreClient(), 'ask', limit);
}

/** The person's chats with Dash for the list on /ask (plan #1899.2), with the workspaces each touched. */
export async function listAskChatsInRequest(timezone: string, limit = 200): Promise<AskChat[]> {
  await requireUser();
  return listAskChats(await createCoreClient(), timezone, limit);
}

/** Rename, pin or archive one of the person's chats (plan #1899.6); false when it is not theirs or not there. */
export async function editAskChatInRequest(ref: string, edit: AskChatEdit): Promise<boolean> {
  await requireUser();
  return editAskChat(await createCoreClient(), ref, edit);
}

/** The person's chats in which `query` was said, by them or by Dash (plan #1899.6). */
export async function searchAskChatsInRequest(query: string): Promise<AskChatHit[]> {
  await requireUser();
  return searchAskChats(await createCoreClient(), query);
}

/** One chat's own name and whether it is archived, or null when it is not theirs or not there. */
export async function loadAskChatMetaInRequest(ref: string) {
  await requireUser();
  return loadAskChatMeta(await createCoreClient(), ref);
}

/** One past question's turns, oldest first, with each answer's lookups and citations; empty when it is not theirs or not there. */
export async function loadAskConversation(ref: string): Promise<TalkTurn[]> {
  await requireUser();
  const core = await createCoreClient();
  return withTurnFiles(core, await loadConversation(core, { kind: 'ask', ref }));
}

/**
 * What asking Dash cost while one chat's answers were written (plan
 * #1899.4), in micro-dollars, or null when the ledger holds nothing for it.
 * The ledger does not name the chat, so this reads the asking rows in the
 * chat's span and keeps those between each question and its answer
 * (chatCostMicros). Never throws: a failed read says nothing was recorded.
 */
export async function loadAskChatCost(turns: readonly TalkTurn[]): Promise<number | null> {
  const span = chatSpan(turns);
  if (!span) return null;
  try {
    await requireUser();
    const core = await createCoreClient();
    const { data, error } = await core
      .from('model_spend')
      .select('created_at, cost_micros')
      .eq('module', 'core')
      .in('operation', ASK_SPEND_OPERATIONS)
      .gte('created_at', span.from)
      .lte('created_at', span.to)
      .limit(500);
    if (error) throw new Error(error.message);
    const marks = ((data ?? []) as { created_at: string; cost_micros: number | null }[]).map((row) => ({
      createdAt: row.created_at,
      costMicros: row.cost_micros,
    }));
    return chatCostMicros(turns, marks);
  } catch (error) {
    console.error('ask chat cost was not read', error);
    return null;
  }
}

/** The ledger's operations for answering a question: the answer, and recalling notes for it. */
const ASK_SPEND_OPERATIONS = ['ask-dash', RECALL_OPERATION];

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
    // A quick note's file comes out of the vault too (plan #1894.2).
    undoVaultNote: (action) => undoVaultCapture({ userId: user.id, core, db: requestAskDb() }, action),
    paidTool: paidToolNamed,
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

/** Take a Decline back: the change is proposed again, or say why not. */
export async function reopenAskChange(id: string): Promise<ChangeOutcome> {
  return reopenChange(await changeDeps(), id);
}

/** Take a confirmed change back and mark it undone, or say why not. */
export async function undoAskChange(id: string): Promise<ChangeOutcome> {
  return undoChange(await changeDeps(), id);
}

/**
 * Make one of Dash's answers a todo or a quick note in the vault (plan
 * #1899.7), as the signed-in person, kept as a change under that answer so
 * its card offers Undo. The conversation is read through their own client,
 * so an answer that is not theirs is not found.
 */
export async function saveAskAnswer(ref: string, turnId: string, to: SaveAnswerTo): Promise<SaveAnswerOutcome> {
  const deps = await changeDeps();
  const db = requestAskDb();
  return saveAnswer(
    {
      enabledModules: deps.enabledModules,
      turns: (conversationId) => loadConversation(deps.core, { kind: 'ask', ref: conversationId }),
      writeTodo: (input) => writeChange(deps, { kind: 'add_todo', input }),
      fileNote: (text, title) => fileVaultNote(deps.userId, text, title),
      readRow: async (subjectRef) => {
        try {
          return await readSubject(db, subjectRef);
        } catch (error) {
          console.error(`saving an answer: reading ${subjectRef} for the record failed`, error);
          return null;
        }
      },
      keep: (conversationId, made) => insertMadeChange(deps.core, deps.userId, conversationId, made),
      attach: (changeId, answerId) => attachProposals(deps.core, [changeId], answerId),
    },
    ref,
    turnId,
    to,
  );
}

/**
 * A thumbs up or down on one of Dash's answers (plan #2285.2), as the
 * signed-in person. The chat must be one of their Ask Dash chats and the
 * turn one of Dash's in it; every read and the write also name their id, so
 * nobody else's turn is reached even past RLS.
 */
export async function rateAskAnswer(
  ref: string,
  turnId: string,
  rating: AnswerRating | null,
  note: string | null,
): Promise<RateAnswerOutcome> {
  const user = await requireUser();
  const core = await createCoreClient();
  return rateAnswer(
    {
      readRole: async (conversationId, id) => {
        const [chat, turn] = await Promise.all([
          core
            .from('conversations')
            .select('id')
            .eq('id', conversationId)
            .eq('user_id', user.id)
            .eq('subject_kind', 'ask')
            .maybeSingle(),
          core
            .from('conversation_turns')
            .select('role')
            .eq('id', id)
            .eq('conversation_id', conversationId)
            .eq('user_id', user.id)
            .maybeSingle(),
        ]);
        if (chat.error) throw new Error(`Reading the chat failed: ${chat.error.message}`);
        if (turn.error) throw new Error(`Reading the answer failed: ${turn.error.message}`);
        if (!chat.data || !turn.data) return null;
        return (turn.data as { role: string }).role === 'assistant' ? 'assistant' : 'user';
      },
      write: async (conversationId, id, patch) => {
        const { data, error } = await core
          .from('conversation_turns')
          .update(patch)
          .eq('id', id)
          .eq('conversation_id', conversationId)
          .eq('user_id', user.id)
          .eq('role', 'assistant')
          .select('id');
        if (error) throw new Error(`Keeping the rating failed: ${error.message}`);
        return (data ?? []).length;
      },
    },
    ref,
    turnId,
    rating,
    note,
  );
}

/**
 * Stop pressed on the reply being written in one of the person's chats (plan
 * #2854.4). The run writing it reads the mark within a second and keeps what
 * it had written; false when nothing was being written.
 */
export async function stopAskReply(ref: string): Promise<boolean> {
  const user = await requireUser();
  return requestStop(await createCoreClient(), user.id, ref);
}

/**
 * Where the reply to a chat's last question stands (plan #2854.4), given its
 * turns as just read: still being written, failed, or nothing waiting.
 */
export async function loadAskReply(ref: string, turns: readonly TalkTurn[]): Promise<ReplyState> {
  const user = await requireUser();
  const row = await readReply(await createCoreClient(), user.id, ref);
  return replyStateOf(row, turns.at(-1)?.role ?? null, Date.now());
}
