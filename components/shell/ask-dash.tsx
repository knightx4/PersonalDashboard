'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import Link, { linkVariants } from '@/components/ui/link';
import { IconButton, iconButtonVariants } from '@/components/ui/icon-button';
import { cn } from '@/lib/cn';
import { SectionHeading } from '@/components/ui/section-heading';
import { usePathname } from 'next/navigation';
import { ArrowLeft, History, Maximize2, MessageSquareText, SquarePen, X } from 'lucide-react';
import { ModuleMark } from '@/components/ui/module-mark';
import { DashWelcome } from '@/components/talk/dash-welcome';
import { DashChanges, type ChangePresses } from '@/components/talk/dash-changes';
import { LookupFold, LookupList } from '@/components/talk/lookup-lines';
import { Thread, type ServerReply, type TalkSend, type ThreadCost } from '@/components/thread/thread';
import { AnswerActions } from '@/components/talk/answer-actions';
import { PaidCostsProvider } from '@/components/ui/paid-hint';
import { scrim } from '@/components/ui/popover';
import { commentWhen } from '@/lib/comments/when';
import type { PaidCosts } from '@/lib/core/spend/paid-actions';
import { isAskPath, roughPageName } from '@/lib/ask/page-name';
import type { AskListFilter, AskRows } from '@/lib/ask/list-filter';
import type { AskDashResult } from '@/lib/dash/ask';
import type { DashChange } from '@/lib/talk/changes';
import {
  heardLookup,
  readAskStream,
  STREAM_CUT,
  type AskedWire,
  type LookupLine,
  type LookupWire,
} from '@/lib/talk/lookups';
import type { AskMention } from '@/lib/talk/ask-input';
import { heldTogether } from '@/lib/talk/held';
import type { ModuleId } from '@/lib/modules';
import type { SearchHit } from '@/lib/search/sources';
import { useAskBox, type AskBoxSent, type AskBoxStart } from '@/components/talk/ask-box';
import type { ConversationSummary } from '@/lib/talk/store';
import type { TalkTurn } from '@/lib/talk/talk';
import type { ReplyState } from '@/lib/talk/reply-state';
import type { UploadedAttachment } from '@/lib/attachments/rules';
import { filesEstimate } from '@/lib/dash/file-cost';
import { DASH_MODELS } from '@/lib/dash/models';
import { useClockNow } from '@/lib/use-clock-now';
import {
  type OpenedAsk,
  askDashCosts,
  askDashPageLabel,
  confirmDashChange,
  declineDashChange,
  reopenDashChange,
  openAskQuestion,
  pollAskQuestion,
  recentAskQuestions,
  rateDashAnswer,
  saveDashAnswer,
  undoDashChange,
} from '@/app/chat/dash/actions';
import { chatSessionOptionsAction, startSessionFromChatAction } from '@/app/chat/dash/session-actions';
import { offersSession } from '@/lib/talk/chat-to-session';
import { Tooltip } from '@/components/ui/tooltip';
import { ModelChip, modelLabel } from '@/components/talk/model-chip';
import { SessionSentLine, ThinkSwitch, ThoughtLine } from '@/components/talk/think-switch';
import { getDashModel, setDashModel, type SetDashModelResult } from '@/lib/dash/model-choice-actions';
import { ChatRow, PaneChat, useChatEntries, type PaneChats } from '@/components/shell/ask-dash-chats';
import { PersonMark } from '@/components/patterns/messaging';
import { GroupMark } from '@/app/chat/group-parts';
import {
  olderGroupMessages,
  olderMessages,
  paneThread,
  paneThreads,
  readGroup,
  readThread,
  retryReply,
  threadBuilds,
  threadChanges,
} from '@/app/chat/actions';
import { groupHref } from '@/lib/you/group-chats-model';
import { personInitials, threadHref } from '@/lib/you/chat-threads-model';
import { DASH_PICK, pickId, pickOf, type PanePick } from '@/lib/you/pane-threads-model';
import type { DashChoiceId } from '@/lib/core/models';

/**
 * Ask Dash, from any page (plan #1090).
 *
 * The Dash button in the top bar opens a sheet where you type a question and
 * read the answer, with the rows it used as links under it. ⌘K offers the
 * same for whatever was typed there, and sends it on arrival. The sheet is
 * the News discuss sheet's shape (app/news/quick/discuss-sheet.tsx): up from
 * the bottom on a phone, in from the right on a laptop, so the page stays in
 * view beside it.
 *
 * A question starts a conversation that is kept (core.conversations, kind
 * `ask`), so Earlier questions in the sheet's header lists the last few and
 * Dash's page lists them all; either reopens one to carry on. Following a
 * link in an answer closes the sheet, since the page it goes to is what was
 * asked for.
 *
 * Since plan #2981 the sheet is also a quick way into every Messages chat: a
 * row of marks under the header, Dash first, switches the sheet to that live
 * thread in place (components/shell/ask-dash-chats.tsx). It always opens on
 * Dash, and the words left in each chat's box wait there for its return.
 *
 * The state is in a provider for the same reason as capture's
 * (components/shell/capture.tsx): opening it must not re-render the page, and
 * both the button and ⌘K need to open it.
 */

/**
 * What else goes with a question (plan #1899.5): the signal that stops it,
 * the rows added with @, and the workspace its lookups are kept to.
 */
export type AskMore = {
  signal?: AbortSignal;
  rows?: AskMention[];
  scope?: ModuleId | null;
  /** "Think it through" is on (plan #2789.10). */
  think?: boolean;
  /** Try again (plan #2854.4): answer the chat's last question instead of adding one. */
  retry?: boolean;
};

/**
 * Where the sheet reads and writes: the server actions in app/chat/dash/actions.ts,
 * or typed fixtures in the surface gallery, which cannot sign in.
 */
export type AskSource = ChangePresses & {
  /**
   * Ask, and hear each lookup as it starts and finishes (plan #1438) and
   * each piece of the answer as it is written (plan #1902). A source that
   * cannot say either ignores the listener, and the thread shows the waiting
   * line until the answer lands. When `more.signal` aborts, it resolves with
   * the question and the answer as kept when it was stopped (plan #1899.5).
   */
  ask: (
    question: string,
    conversationRef: string | null,
    page?: string | null,
    onLookup?: (lookup: LookupWire) => void,
    files?: UploadedAttachment[],
    list?: AskListFilter | null,
    onText?: (piece: string) => void,
    more?: AskMore,
  ) => Promise<AskDashResult>;
  recent: typeof recentAskQuestions;
  open: typeof openAskQuestion;
  poll: typeof pollAskQuestion;
  costs: typeof askDashCosts;
  label: typeof askDashPageLabel;
  /** Make an answer a todo or a vault note, kept as a change under it (plan #1899.7). */
  save: typeof saveDashAnswer;
  /** A thumbs up or down on an answer, or null to take it back (plan #2285.2). */
  rate: typeof rateDashAnswer;
  /**
   * Save the model Dash answers with (plan #2458.3). The gallery's fixtures
   * leave it out, and a pick there is kept on the page alone.
   */
  setModel?: (model: DashChoiceId) => Promise<SetDashModelResult>;
  /**
   * Take the chat to a session thread (plan #2789.8): the projects to pick
   * from, and the start. The gallery's fixtures leave it out for the ones that
   * do not draw the button.
   */
  toSession?: {
    options: typeof chatSessionOptionsAction;
    start: typeof startSessionFromChatAction;
  };
  /** Read the saved model again, after Dash changed it in an answer (plan #2458.4). */
  getModel?: () => Promise<DashChoiceId>;
  /**
   * The Messages chats the sheet switches to (plan #2981). A source without
   * them draws Dash alone, with no row.
   */
  chats?: PaneChats;
};

/**
 * Asks through app/api/ask/route.ts, which streams the lookups as they run
 * and the answer as it is written.
 * The route answers 401 when the session has gone; anything that is not a
 * stream comes back as an error for the thread, never a throw.
 */
async function askLive(
  question: string,
  conversationRef: string | null,
  page: string | null = null,
  onLookup?: (lookup: LookupWire) => void,
  files?: UploadedAttachment[],
  list: AskListFilter | null = null,
  onText?: (piece: string) => void,
  more: AskMore = {},
): Promise<AskDashResult> {
  const { signal, rows, scope, think, retry } = more;
  // The question as the route kept it, heard before Dash answers: what a
  // stopped answer is found again by (plan #1899.5).
  let asked: AskedWire | null = null;
  // Stop is its own press (plan #2854.4): leaving the page no longer ends the
  // answer, so the request is not cut. The chat is marked, the run ends the
  // answer, and the stream brings back what was kept. Pressed before the
  // question was kept, the mark goes as soon as its chat is known.
  let stopPressed = false;
  const sendStop = () => {
    if (!asked) return;
    void fetch('/api/ask/stop', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ conversationRef: asked.conversation.ref }),
    }).catch(() => {});
  };
  signal?.addEventListener(
    'abort',
    () => {
      stopPressed = true;
      sendStop();
    },
    { once: true },
  );
  let response: Response;
  try {
    response = await fetch('/api/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        question,
        conversationRef,
        page,
        files,
        list,
        rows,
        scope,
        ...(think ? { think: true } : {}),
        ...(retry ? { retry: true } : {}),
      }),
    });
  } catch {
    return { turns: [], error: 'Dash could not be asked. Check your connection and try again.' };
  }
  if (response.status === 401) return { turns: [], error: 'You are signed out. Sign in again to ask Dash.' };
  if (!response.ok || !response.body) {
    return { turns: [], error: 'Dash could not be asked. Check your connection and try again.' };
  }
  try {
    const result = await readAskStream(
      response.body,
      (lookup) => onLookup?.(lookup),
      (piece) => onText?.(piece),
      (heard) => {
        asked = heard;
        if (stopPressed) sendStop();
      },
    );
    if (result.error === STREAM_CUT && asked) return keptWhenStopped(asked);
    return result;
  } catch {
    if (asked) return keptWhenStopped(asked);
    return { turns: [], error: STREAM_CUT };
  }
}

/** How long a stopped question is looked for: the route keeps it a moment after the stop. */
const STOPPED_LOOKS = 10;
const STOPPED_LOOK_MS = 400;

/**
 * The question and its answer as the route kept them when the stream was
 * cut before its result line (plan #1899.5): the conversation the `asked`
 * line named is read back until the answer is in it. Since plan #2854.4 the
 * answer carries on on the server when the stream goes, so one not in yet
 * is said to be on its way, and reopening the chat shows it.
 */
async function keptWhenStopped(asked: AskedWire | null): Promise<AskDashResult> {
  if (!asked) return { turns: [], error: 'Stopped before Dash had your question.' };
  const question = asked.turns.find((turn) => turn.role === 'user');
  for (let look = 0; look < STOPPED_LOOKS; look++) {
    await new Promise((resolve) => setTimeout(resolve, STOPPED_LOOK_MS));
    const opened = await openAskQuestion(asked.conversation.ref).catch(() => null);
    if (!opened || opened.error) continue;
    const at = question ? opened.turns.findIndex((turn) => turn.id === question.id) : -1;
    const since = at >= 0 ? opened.turns.slice(at) : [];
    if (!since.some((turn) => turn.role === 'assistant')) continue;
    const ids = new Set(since.map((turn) => turn.id));
    return {
      conversation: asked.conversation,
      turns: since,
      stop: 'stopped',
      changes: opened.changes.filter((change) => change.turnId && ids.has(change.turnId)),
    };
  }
  return {
    conversation: asked.conversation,
    turns: asked.turns,
    error: 'The connection dropped, but Dash is still answering. Reopen this chat in a moment to read the reply.',
  };
}

const ACTIONS: AskSource = {
  ask: askLive,
  recent: recentAskQuestions,
  open: openAskQuestion,
  poll: pollAskQuestion,
  costs: askDashCosts,
  label: askDashPageLabel,
  save: saveDashAnswer,
  rate: rateDashAnswer,
  toSession: { options: chatSessionOptionsAction, start: startSessionFromChatAction },
  setModel: setDashModel,
  getModel: getDashModel,
  confirm: confirmDashChange,
  decline: declineDashChange,
  reopen: reopenDashChange,
  undo: undoDashChange,
  chats: {
    list: paneThreads,
    open: paneThread,
    live: {
      thread: { older: olderMessages, read: readThread, retryReply, changes: threadChanges, builds: threadBuilds },
      group: { older: olderGroupMessages, read: readGroup },
      presses: { confirm: confirmDashChange, decline: declineDashChange, reopen: reopenDashChange, undo: undoDashChange },
    },
  },
};

type AskDashHandle = {
  /**
   * Open the sheet on a new question, sending `question` at once when given.
   * `rows` attaches a filtered list to it (plan #1658).
   */
  open: (question?: string, rows?: AskRows) => void;
  source: AskSource;
  /** Whose rows @ in the box searches (plan #1899.5); absent, @ offers none. */
  account?: string;
  /** The workspaces the box's scope chip and commands offer. */
  workspaces?: readonly ModuleId[];
  /** For the gallery: the rows @ searches in place of the account's. */
  searchHits?: readonly SearchHit[];
  /** For the gallery: the words the sheet's box opens with, unsent (plan #1899.8). */
  draft?: string;
  /**
   * The model the next question is answered with (plan #2458.3), held here so
   * a pick in the popup shows on the Dash page and the reverse, and each box
   * prices its answers for it (plan #2458.2). The shell seeds it from
   * core.account_settings.dash_model; absent, Sonnet.
   */
  model?: DashChoiceId;
  /** Read the saved model again: called when an answer says Dash changed it. */
  refreshModel?: () => void;
  /** Pick a model: shown at once, saved, and put back with `modelFailed` said if the save fails. */
  chooseModel?: (model: DashChoiceId) => void;
  modelFailed?: string | null;
  /** For the gallery: the model list drawn open. */
  modelOpen?: boolean;
};

const AskDashContext = createContext<AskDashHandle | null>(null);

/**
 * The handle, or null outside the shell. Null rather than a throw so a search
 * box drawn on its own (the gallery, a test) simply has no Ask Dash row.
 */
export function useAskDash(): AskDashHandle | null {
  return useContext(AskDashContext);
}

const ACTION = 'app/api/ask/route.ts#POST';

/** One opening of the sheet; the key makes a fresh one on every open. */
type Session = { key: number; ask?: string; rows?: AskRows };

/**
 * One sheet per page. A provider inside another stands down, so the gallery
 * can wrap the whole shell in one fed with fixtures and the shell's own
 * provider leaves the job to it.
 */
type AskDashBox = Pick<AskDashHandle, 'account' | 'workspaces' | 'searchHits' | 'draft' | 'model'> & {
  /** For the gallery: the box drawn with the model list open, or after a pick that could not be saved. */
  modelStart?: 'open' | 'failed';
};

export function AskDashProvider({
  source,
  page,
  children,
  ...box
}: AskDashBox & {
  source?: AskSource;
  /** The address the sheet treats as the page, for the gallery; the real one otherwise. */
  page?: string;
  children: React.ReactNode;
}) {
  const outer = useContext(AskDashContext);
  if (outer) return <>{children}</>;
  return (
    <AskDashRoot source={source ?? ACTIONS} page={page} {...box}>
      {children}
    </AskDashRoot>
  );
}

function AskDashRoot({
  source,
  page,
  children,
  account,
  workspaces,
  searchHits,
  draft,
  model: initialModel,
  modelStart,
}: AskDashBox & {
  source: AskSource;
  page?: string;
  children: React.ReactNode;
}) {
  const [session, setSession] = useState<Session | null>(null);
  // Seeded by the shell, kept here once the person picks: a later render of
  // the shell with the old value does not undo a pick.
  const [model, setModel] = useState<DashChoiceId>(initialModel ?? (DASH_MODELS.ask as DashChoiceId));
  const [modelFailed, setModelFailed] = useState<string | null>(() =>
    modelStart === 'failed' ? `Not saved. Still ${modelLabel(initialModel ?? (DASH_MODELS.ask as DashChoiceId))}.` : null,
  );
  const saving = useRef(0);
  // Dash switched the model in an answer: read what was saved, unless a pick
  // made meanwhile has taken over.
  const refreshModel = useCallback(() => {
    if (!source.getModel) return;
    const turn = saving.current;
    void source
      .getModel()
      .then((saved) => {
        if (turn === saving.current) setModel(saved);
      })
      .catch(() => undefined);
  }, [source]);
  const chooseModel = useCallback(
    (next: DashChoiceId) => {
      const before = model;
      const turn = ++saving.current;
      setModel(next);
      setModelFailed(null);
      if (!source.setModel) return;
      void source
        .setModel(next)
        .catch((): SetDashModelResult => ({ ok: false, error: 'Could not save that choice.' }))
        .then((result) => {
          // A later pick has taken over; its own save decides what shows.
          if (result.ok || turn !== saving.current) return;
          setModel(before);
          setModelFailed(`Not saved. Still ${modelLabel(before)}.`);
        });
    },
    [model, source],
  );
  // The failure line goes after a while, as a toast would.
  useEffect(() => {
    if (!modelFailed || modelStart === 'failed') return;
    const timer = setTimeout(() => setModelFailed(null), 6000);
    return () => clearTimeout(timer);
  }, [modelFailed, modelStart]);
  const opened = useRef(0);
  const open = useCallback((question?: string, rows?: AskRows) => {
    opened.current += 1;
    const ask = question?.trim();
    setSession({ key: opened.current, ask: ask || undefined, rows });
  }, []);
  const close = useCallback(() => setSession(null), []);
  const handle = useMemo<AskDashHandle>(
    () => ({
      open,
      source,
      account,
      workspaces,
      searchHits,
      draft,
      model,
      chooseModel,
      refreshModel,
      modelFailed,
      modelOpen: modelStart === 'open',
    }),
    [open, source, account, workspaces, searchHits, draft, model, chooseModel, refreshModel, modelFailed, modelStart],
  );

  // A link in an answer goes somewhere else in the app, and the sheet should
  // not stay over the page it opened.
  const pathname = usePathname();
  const at = useRef(pathname);
  useEffect(() => {
    if (at.current === pathname) return;
    at.current = pathname;
    setSession(null);
  }, [pathname]);

  return (
    <AskDashContext.Provider value={handle}>
      {children}
      {session && (
        <AskDashSheet
          key={session.key}
          ask={session.ask}
          rows={session.rows}
          page={page ?? pathname}
          source={source}
          onClose={close}
        />
      )}
    </AskDashContext.Provider>
  );
}

/** The button in the top bar, beside capture. */
export function AskDashButton() {
  const handle = useAskDash();
  if (!handle) return null;
  return (
    <Tooltip label="Ask Dash" className="shrink-0">
      <IconButton
        label="Ask Dash"
        onClick={() => handle.open()}
        className="text-shell-muted hover:bg-shell-hover hover:text-shell-ink [&_svg]:size-6!"
      >
        {/* Dash on its charcoal plate, as the switcher and the chats show him (note 49ba62cf). */}
        <ModuleMark module="dash" size="sm" />
      </IconButton>
    </Tooltip>
  );
}

/**
 * Sends a question and keeps the conversation it started, so the next one in
 * the same thread continues it. `onConversation` hears the ref once there is
 * one, and `onChanges` the changes Dash proposed in each answer. `page` is
 * the address sent with every question, read when it is sent (plan #1271).
 */
export function useAskSend(
  initialRef: string | null,
  page: string | null,
  onConversation?: (ref: string) => void,
  onChanges?: (changes: DashChange[]) => void,
  onHandedOff?: (count: number) => void,
  onLookup?: (lookup: LookupWire) => void,
  list: AskListFilter | null = null,
  onText?: (piece: string) => void,
  /** What else goes with each question as it is sent: its stop signal, the rows added with @ and the scope (plan #1899.5). */
  more?: () => AskMore,
): TalkSend {
  const source = useAskDash()?.source ?? ACTIONS;
  const ref = useRef(initialRef);
  const heard = useRef({ onConversation, onChanges, onHandedOff, onLookup, onText, page, list, more });
  useEffect(() => {
    heard.current = { onConversation, onChanges, onHandedOff, onLookup, onText, page, list, more };
  });
  return useCallback<TalkSend>(async (body, files, options) => {
    const more = heard.current.more?.();
    const result = await source.ask(
      body,
      ref.current,
      heard.current.page,
      (lookup) => heard.current.onLookup?.(lookup),
      files,
      heard.current.list,
      (piece) => heard.current.onText?.(piece),
      options?.retry ? { ...more, retry: true } : more,
    );
    if (result.conversation && result.conversation.ref !== ref.current) {
      ref.current = result.conversation.ref;
      heard.current.onConversation?.(result.conversation.ref);
    }
    if (result.changes && result.changes.length > 0) heard.current.onChanges?.(result.changes);
    const started = result.handoffs?.filter((h) => h.status === 'fired').length ?? 0;
    if (started > 0) heard.current.onHandedOff?.(started);
    return { turns: result.turns, error: result.error };
  }, [source]);
}

/** Today as YYYY-MM-DD on this device, so a due date this year leaves the year off. */
function localToday(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * A question to Dash and its answers, with the changes each answer proposed
 * drawn under it as cards (plan #1190). The sheet and the /ask page both draw
 * this. `changes` are the ones already kept for the conversation, each tied
 * to its answer by turnId; an answer that proposes more adds them here.
 */
export function AskThread({
  id,
  conversationRef,
  page = null,
  list = null,
  turns,
  changes: initialChanges = [],
  openHandoffs = 0,
  reply: initialReply = null,
  onConversation,
  onSend,
  onAnswered,
  boxStart,
  bubbles = false,
  ...thread
}: {
  id: string;
  conversationRef: string | null;
  /** Requests already with the backup routine and not yet replied to (plan #1402). */
  openHandoffs?: number;
  /** The reply to the last question as the server held it when the chat was read (plan #2854.4). */
  reply?: ReplyState;
  /** The app address each question is asked from; null tells Dash no page. */
  page?: string | null;
  /** The filter of a list sent with each question (plan #1658); null sends none. */
  list?: AskListFilter | null;
  turns: readonly TalkTurn[];
  changes?: readonly DashChange[];
  onConversation?: (ref: string) => void;
  /** Heard on every question sent, before the answer comes. */
  onSend?: () => void;
  /** Heard once each answer has come back, kept or not: the Dash page re-reads what the chat used (plan #1899.4). */
  onAnswered?: () => void;
  label: string;
  placeholder?: string;
  /** Before the first question: what Dash says he can do, drawn as his opening turn. */
  opening?: string;
  /** Just above the question box: the page Dash will be told (plan #1272). */
  above?: React.ReactNode;
  startWriting?: boolean;
  /** The box always open at the foot of the pane, as on the Dash page. */
  dock?: boolean;
  ask?: string;
  /** For the preview gallery: the box opens with these words in it. */
  initialDraft?: string;
  /** For the preview gallery: the thread drawn with this question on its way (plan #2262.1). */
  pendingQuestion?: string;
  /** For the preview gallery: texts sent while the pending question is answered, held under it (plan #2988.2). */
  heldQuestions?: readonly string[];
  /** For the preview gallery: the box opens with rows added or a workspace chosen (plan #1899.5). */
  boxStart?: AskBoxStart;
  /**
   * Drawn as Chat's Dash tab draws it (plan #2748.12): questions in bubbles,
   * and what Dash looked up folded under his name, above the answer.
   */
  bubbles?: boolean;
}) {
  const handle = useAskDash();
  const source = handle?.source ?? ACTIONS;
  const model = handle?.model ?? (DASH_MODELS.ask as DashChoiceId);
  const refreshModel = handle?.refreshModel;
  const cost = useMemo(() => askCost(model), [model]);
  // The question on its way, which Stop ends (plan #1899.5).
  const running = useRef<AbortController | null>(null);
  // @ rows, / commands and the scope chip in the box (plan #1899.5).
  const box = useAskBox({
    account: handle?.account,
    workspaces: handle?.workspaces,
    fixtureHits: handle?.searchHits,
    start: boxStart,
  });
  // What each held text took off the box (plan #2988.2): the rows go with
  // the question the held texts become, and the newest scope with them.
  const heldRows = useRef<AskBoxSent[]>([]);
  const takeRows = (): AskBoxSent => {
    const taken = heldRows.current.splice(0);
    return taken.length > 0 ? heldTogether(taken) : box.take();
  };
  // "Think it through" (plan #2789.10): on until pressed again.
  const [think, setThink] = useState(boxStart?.think ?? false);
  const [changes, setChanges] = useState<DashChange[]>([...initialChanges]);
  const [ref, setRef] = useState(conversationRef);
  const [open, setOpen] = useState(openHandoffs);
  const handedBack = useHandoffReplies(source, ref, open > 0, setOpen);
  // A reply still being written by a run this page did not start (plan #2854.4).
  const [reply, setReply] = useState<ServerReply>(() => serverReplyOf(initialReply));
  const answeredElsewhere = useReplyArrival(source, ref, reply?.state === 'answering', setReply);
  const incoming = answeredElsewhere ?? handedBack;
  // What Dash is looking up for the answer on its way (plan #1438), emptied
  // on each question; the answer once landed shows its own, folded.
  const [live, setLive] = useState<LookupLine[]>([]);
  // The answer as far as Dash has written it (plan #1902), emptied on each
  // question; the saved turn takes its place when the answer lands.
  const [written, setWritten] = useState('');
  const send = useAskSend(
    conversationRef,
    page,
    (next) => {
      setRef(next);
      onConversation?.(next);
    },
    (added) => {
      setChanges((current) => [...current.filter((c) => !added.some((a) => a.id === c.id)), ...added]);
      // Dash switched the model when asked (plan #2458.4): the chip reads it again.
      if (added.some((c) => c.kind === 'set_dash_model' && c.status === 'done')) refreshModel?.();
    },
    (count) => setOpen((current) => current + count),
    (lookup) => setLive((current) => heardLookup(current, lookup)),
    list,
    (piece) => setWritten((current) => current + piece),
    () => ({ ...takeRows(), signal: running.current?.signal, think }),
  );
  const onChanged = useCallback(
    (next: DashChange) => {
      setChanges((current) => current.map((c) => (c.id === next.id ? next : c)));
      // Undoing Dash's switch of the model puts the old one back on the chip.
      if (next.kind === 'set_dash_model') refreshModel?.();
    },
    [refreshModel],
  );
  const [today] = useState(localToday);
  // The chat's ref is stable once kept, so the source is too (plan #2789.8).
  const sessionSource = useMemo(() => {
    const to = source.toSession;
    if (!to || !ref) return undefined;
    return { options: () => to.options(ref), start: (projectId: string | null) => to.start({ ref, projectId }) };
  }, [source.toSession, ref]);

  const byTurn = useMemo(() => {
    const map = new Map<string, DashChange[]>();
    for (const change of changes) {
      if (!change.turnId) continue;
      map.set(change.turnId, [...(map.get(change.turnId) ?? []), change]);
    }
    return map;
  }, [changes]);

  return (
    <Thread
      id={id}
      turns={turns}
      withFiles
      cost={cost}
      // Heard as the question is sent, outside the transition that waits for
      // the answer, so what it changes (the sheet's opening message going)
      // happens with the press rather than when the answer lands (plan #1899.8).
      // The last answer's lookups and words are emptied here for the same
      // reason: emptied inside the transition, they stayed up until the new
      // answer landed, and the waiting line drew the last answer again
      // beneath your question (plan #2262.1).
      onSubmit={() => {
        setLive([]);
        setWritten('');
        onSend?.();
      }}
      send={async (body, files) => {
        const controller = new AbortController();
        running.current = controller;
        const result = await send(body, files).finally(() => onAnswered?.());
        if (running.current === controller) running.current = null;
        // A question that was not kept goes back in the box, and its rows with it.
        if (!result.turns?.length) box.restore();
        return result;
      }}
      onStop={() => running.current?.abort()}
      // Questions sent in a row, or while an answer is written, go as one (plan #2988.2).
      together
      // The sheet's opening message goes with the press, as a question sent at once does.
      onHold={() => {
        heldRows.current.push(box.take());
        onSend?.();
      }}
      {...box.thread}
      // A model pick that could not be saved: said in the box, above the words,
      // where the foot has no room for it (plan #2458.3).
      attached={
        handle?.modelFailed ? (
          <>
            {box.thread.attached}
            <p role="status" className="pb-1 text-small text-danger">
              {handle.modelFailed}
            </p>
          </>
        ) : (
          box.thread.attached
        )
      }
      boxStart={
        <>
          {box.thread.boxStart}
          {/* On Chat's Dash tab they sit under the box as quiet words (plan #2863). */}
          <ThinkSwitch on={think} onChange={setThink} quiet={bubbles} />
          {/* Thinking it through answers on Opus whatever was picked, so the pick steps aside. */}
          {!think && handle?.model && handle.chooseModel ? (
            <ModelChip model={handle.model} onModel={handle.chooseModel} initialOpen={handle.modelOpen} quiet={bubbles} />
          ) : null}
        </>
      }
      waiting={ASK_WAITING}
      working={<LookupList lines={live} label="What Dash is looking up" />}
      written={written}
      activity="searching"
      incoming={incoming}
      serverReply={reply}
      canRetry={Boolean(ref)}
      bubbles={bubbles}
      lead={bubbles ? (turn) => (turn.role === 'assistant' ? <LookupFold calls={turn.toolCalls} quiet /> : null) : undefined}
      below={(turn, thread) => {
        if (turn.role !== 'assistant') return null;
        const mine = byTurn.get(turn.id);
        return (
          <>
            {mine ? <DashChanges changes={mine} presses={source} onChanged={onChanged} today={today} /> : null}
            {!bubbles && <LookupFold calls={turn.toolCalls} />}
            {/* What a thought-through answer cost (plan #2789.10). */}
            <ThoughtLine calls={turn.toolCalls} />
            {/* A question sent to a session thread, followed live (plan #2789.11). */}
            <SessionSentLine calls={turn.toolCalls} />
            {/* Copy, ask again, and keep the answer elsewhere (plan #1899.7).
                A todo or a note comes back as a change, drawn above with Undo.
                In a chat on the page they rest under every answer but the
                latest until it is pointed at, from laptop width; a touch
                screen, with nothing to point with, keeps them (plan #2748.12). */}
            <div
              className={
                bubbles && !thread.latest
                  ? 'min-[720px]:opacity-0 min-[720px]:transition-opacity min-[720px]:group-hover:opacity-100 min-[720px]:group-focus-within:opacity-100 pointer-coarse:opacity-100'
                  : undefined
              }
            >
            <AnswerActions
              body={turn.body}
              question={thread.question}
              busy={thread.busy}
              onRetry={thread.resend}
              onEdit={thread.edit}
              save={ref ? (to) => source.save(ref, turn.id, to) : undefined}
              onSaved={(change) =>
                setChanges((current) => [...current.filter((c) => c.id !== change.id), change])
              }
              // Thumbs up and down (plan #2285.2), once the chat is kept and has a ref.
              rated={{ rating: turn.rating ?? null, note: turn.ratingNote ?? null }}
              rate={ref ? (rating, note) => source.rate(ref, turn.id, rating, note) : undefined}
              // To a session thread on a project (plan #2789.8), once the chat is kept.
              toSession={sessionSource}
              offerSession={offersSession(turn.body)}
            />
            </div>
          </>
        );
      }}
      {...thread}
    />
  );
}

/** How often a thread waiting on the backup routine checks for its reply. */
const HANDOFF_POLL_MS = 20_000;
/** How long it keeps checking before leaving it to a reopen: a run past this has likely failed. */
const HANDOFF_POLL_FOR_MS = 30 * 60_000;

/**
 * While requests in this conversation are with the backup routine (plan
 * #1402), reads the conversation every twenty seconds and hands back its
 * turns, so the routine's reply appears without a reload. Stops when none
 * are open, or after half an hour.
 */
function useHandoffReplies(
  source: AskSource,
  ref: string | null,
  waiting: boolean,
  setOpen: (open: number) => void,
): readonly TalkTurn[] | undefined {
  const [incoming, setIncoming] = useState<readonly TalkTurn[]>();
  useEffect(() => {
    if (!ref || !waiting) return;
    const until = Date.now() + HANDOFF_POLL_FOR_MS;
    let live = true;
    const timer = setInterval(() => {
      if (Date.now() > until) {
        clearInterval(timer);
        return;
      }
      source
        .poll(ref)
        .then((found) => {
          if (!live) return;
          if (found.turns.length > 0) setIncoming(found.turns);
          setOpen(found.open);
        })
        .catch(() => {});
    }, HANDOFF_POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [source, ref, waiting, setOpen]);
  return incoming;
}

/** The server's reply state as the thread draws it: when it started is the server's to know. */
function serverReplyOf(reply: ReplyState | undefined): ServerReply {
  if (!reply) return null;
  return reply.state === 'answering' ? { state: 'answering' } : reply;
}

/** How often a thread whose reply is being written elsewhere checks for it (plan #2854.4). */
const REPLY_POLL_MS = 3_000;
/** A reply is read as failed by the server after REPLY_LOST_AFTER_MS, so checking stops a little after. */
const REPLY_POLL_FOR_MS = 6 * 60_000;

/**
 * While the reply to the last question is being written by a run this page
 * did not start (plan #2854.4: the page that asked was left, and this one
 * opened the chat), reads the chat every three seconds and hands back its
 * turns once the reply is in, or the failure once it has failed.
 */
function useReplyArrival(
  source: AskSource,
  ref: string | null,
  waiting: boolean,
  setReply: (reply: ServerReply) => void,
): readonly TalkTurn[] | undefined {
  const [arrived, setArrived] = useState<readonly TalkTurn[]>();
  useEffect(() => {
    if (!ref || !waiting) return;
    const until = Date.now() + REPLY_POLL_FOR_MS;
    let live = true;
    const timer = setInterval(() => {
      if (Date.now() > until) {
        clearInterval(timer);
        return;
      }
      source
        .poll(ref)
        .then((found) => {
          if (!live || found.turns.length === 0) return;
          const next = serverReplyOf(found.reply);
          if (next?.state === 'answering') return;
          setArrived(found.turns);
          setReply(next);
        })
        .catch(() => {});
    }, REPLY_POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [source, ref, waiting, setReply]);
  return arrived;
}

/**
 * What each answer costs, priced by the thread beside the button that opens
 * the box and beside its send arrow, with reading any files added on top,
 * priced for the model the person chose (plan #2458.2).
 */
function askCost(model: DashChoiceId): ThreadCost {
  return {
    action: ACTION,
    what: 'Cost of each answer from Dash',
    plus: (files: readonly UploadedAttachment[]) => filesEstimate(files, model),
  };
}

/** What Dash says while it looks: long enough that the wait needs a reason. */
export const ASK_WAITING = 'Dash is looking it up. A question that needs several lookups can take up to a minute.';

/** What the box suggests while a list's rows are attached (plan #1658). */
const ROWS_PLACEHOLDER = {
  inventory: 'Which of these cost the most?',
  pipeline: "Which of these haven't replied in two weeks?",
} as const;

/** The sheet shows a new question, or an earlier one reopened. */
type View =
  | { kind: 'new'; ask?: string }
  | { kind: 'earlier'; ref: string; title: string | null };

type SheetProps = {
  ask?: string;
  /** A filtered list sent with the question (plan #1658), shown above the box. */
  rows?: AskRows;
  /** The page the sheet was opened over, told to Dash with each question. */
  page: string | null;
  source: AskSource;
  onClose: () => void;
};

/** The sheet, over the page. */
function AskDashSheet(props: SheetProps) {
  return createPortal(<AskDashPanel {...props} />, document.body);
}

/** What the sheet draws, apart from the portal it is drawn through; exported for tests. */
export function AskDashPanel({
  ask,
  rows: sent,
  page: opened,
  source,
  onClose,
}: SheetProps) {
  const [view, setView] = useState<View>({ kind: 'new', ask });
  // The page told to Dash with each question until the chip's × drops it,
  // which lasts for the rest of this sheet (plan #1272). The Ask page tells
  // Dash nothing, so it starts dropped there.
  const [page, setPage] = useState(() => (opened && !isAskPath(opened) ? opened : null));
  const [pageLabel, setPageLabel] = useState<string | null>(null);
  // The list sent with the question until its chip's × drops it; the sheet's
  // later questions in the thread carry it too.
  const [rows, setRows] = useState<AskRows | undefined>(sent);
  // Bumped on every change of view, so the thread below starts afresh.
  const [threadKey, setThreadKey] = useState(0);
  // Whether the question on screen has become a conversation, which is when
  // "New question" has something to leave.
  const [started, setStarted] = useState(false);
  // The chat on screen once it has an address, for the button that opens it
  // on the full page (plan #1899.2).
  const [chatRef, setChatRef] = useState<string | null>(null);
  const [costs, setCosts] = useState<PaidCosts>({});
  // Which chat the sheet has open (plan #2981): Dash on every opening, and
  // any Messages chat one press away in the row. Dash's own chat stays drawn,
  // hidden, while another is open, so going back finds it as it was.
  const [pick, setPick] = useState<PanePick>(DASH_PICK);
  const { entries } = useChatEntries(source.chats);
  // The words left unsent in each chat's box, kept while another is open.
  // Written as they are typed and read when a chat opens, so a change to it
  // needs no redraw.
  const [drafts] = useState(() => new Map<string, string>());
  // Earlier questions, open over Dash's chat in the sheet.
  const [earlier, setEarlier] = useState(false);
  const [recent, setRecent] = useState<{ conversations: ConversationSummary[]; error?: string } | null>(null);
  const earlierOpen = useRef(earlier);
  useEffect(() => {
    earlierOpen.current = earlier;
  }, [earlier]);

  useEffect(() => {
    let live = true;
    source
      .costs()
      .then((found) => {
        if (live) setCosts(found);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [source]);

  // The row's title, or the page's name, in place of the rough name the chip
  // starts with. Asked once, for the page the sheet opened over.
  useEffect(() => {
    if (!page) return;
    let live = true;
    source
      .label(page)
      .then((found) => {
        if (live && found) setPageLabel(found);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per sheet; dropping the page must not ask again
  }, [source]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      // Escape in the box closes the box first (Thread), and marks the
      // event handled; only a second Escape closes the sheet. Earlier
      // questions open goes back to the chat first.
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (earlierOpen.current) setEarlier(false);
      else onClose();
    }
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  function openEarlier() {
    setEarlier(true);
    setRecent(null);
    source
      .recent()
      .catch(() => ({ conversations: [], error: 'Your earlier questions could not be read.' }))
      .then(setRecent);
  }

  function choose(next: PanePick) {
    setPick(next);
    setEarlier(false);
  }

  const openEntry = pick.kind === 'dash' ? null : entries.find((entry) => pickId(pickOf(entry)) === pickId(pick));

  function show(next: View) {
    setEarlier(false);
    setView(next);
    setStarted(next.kind === 'earlier');
    setChatRef(next.kind === 'earlier' ? next.ref : null);
    setThreadKey((key) => key + 1);
  }

  // Rows sent from a list say more than the page they are on, so they take the chip's place.
  const lookingAt = rows ? (
    <LookingAt
      label={rows.label}
      onDrop={() => setRows(undefined)}
      dropTitle="Do not send these rows to Dash"
    />
  ) : page ? (
    <LookingAt label={pageLabel ?? roughPageName(page)} onDrop={() => setPage(null)} />
  ) : null;

  return (
    <div className="fixed inset-0 z-overlay">
      <button type="button" aria-label="Close Dash" onClick={onClose} className={scrim} />
      {/* A floating panel like the menus, not a sheet of the page: in the
          glass themes that makes it frosted and nearly opaque, where the
          surface it used to take let the page show through it (note
          a065b91b). */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="ask-dash-title"
        className="popover-panel absolute inset-x-0 bottom-0 flex max-h-[85dvh] flex-col rounded-t-card border-t border-border bg-raised pb-[env(safe-area-inset-bottom)] md:inset-y-0 md:left-auto md:right-0 md:max-h-none md:w-[min(30rem,100vw)] md:rounded-none md:border-l md:border-t-0 md:pb-0"
      >
        <PaidCostsProvider costs={costs}>
          <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
            <div className="min-w-0">
              <div className="flex min-h-8 items-center gap-2">
                {pick.kind === 'dash' ? (
                  <ModuleMark module="dash" size="sm" />
                ) : openEntry?.kind === 'group' ? (
                  <GroupMark members={openEntry.row.members} size="sm" />
                ) : openEntry?.kind === 'person' ? (
                  <PersonMark initials={personInitials(openEntry.row.name)} colour={openEntry.row.colour} photo={openEntry.row.photo} size="sm" />
                ) : null}
                <h2 id="ask-dash-title" className="min-w-0 truncate text-ui font-semibold text-ink">
                  {pick.kind === 'dash'
                    ? 'Ask Dash'
                    : openEntry?.kind === 'group'
                      ? openEntry.row.title
                      : (openEntry?.row.name ?? 'Chat')}
                </h2>
              </div>
              {pick.kind === 'dash' && !earlier && view.kind === 'earlier' && view.title && (
                <p className="mt-0.5 line-clamp-2 break-words text-ui text-ink-muted">
                  {view.title}
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              {pick.kind === 'dash' ? (
                <>
                  <Tooltip label="Earlier questions" align="end">
                    <IconButton
                      label="Earlier questions"
                      aria-pressed={earlier}
                      onClick={() => (earlier ? setEarlier(false) : openEarlier())}
                      className={earlier ? 'bg-sunken text-ink' : undefined}
                    >
                      <History strokeWidth={1.75} aria-hidden />
                    </IconButton>
                  </Tooltip>
                  <Tooltip label="Open on Dash's page" align="end">
                    <Link
                      href={chatRef ? `/chat/dash/${chatRef}` : '/chat/dash'}
                      aria-label="Open on Dash's page"
                      className={iconButtonVariants()}
                    >
                      <Maximize2 strokeWidth={1.75} aria-hidden />
                    </Link>
                  </Tooltip>
                  {started && (
                    <Tooltip label="New question" align="end">
                      <IconButton label="New question" onClick={() => show({ kind: 'new' })}>
                        <SquarePen strokeWidth={1.75} aria-hidden />
                      </IconButton>
                    </Tooltip>
                  )}
                </>
              ) : (
                <Tooltip label="Open in Messages" align="end">
                  <Link
                    href={pick.kind === 'person' ? threadHref(pick.key) : groupHref(pick.id)}
                    aria-label="Open in Messages"
                    className={iconButtonVariants()}
                  >
                    <Maximize2 strokeWidth={1.75} aria-hidden />
                  </Link>
                </Tooltip>
              )}
              <Tooltip label="Close Dash" align="end">
                <IconButton label="Close Dash" onClick={onClose}>
                  <X strokeWidth={1.75} aria-hidden />
                </IconButton>
              </Tooltip>
            </div>
          </div>

          {source.chats && <ChatRow entries={entries} selected={pickId(pick)} onPick={choose} />}

          {/* A column, so a thread fills it and its box docks at the foot,
              as on the Dash page. Kept drawn while another chat or Earlier
              questions is open, so nothing typed or asked here is lost. */}
          <div
            className={cn(
              'flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-3',
              (pick.kind !== 'dash' || earlier) && 'hidden',
            )}
          >
            {view.kind === 'new' ? (
              <NewQuestion
                key={threadKey}
                ask={view.ask}
                page={page}
                list={rows}
                lookingAt={lookingAt}
                onStarted={(ref) => {
                  setStarted(true);
                  setChatRef(ref);
                }}
              />
            ) : (
              <EarlierQuestion
                key={threadKey}
                conversationRef={view.ref}
                page={page}
                source={source}
                lookingAt={lookingAt}
              />
            )}
          </div>
          {pick.kind === 'dash' && earlier && (
            <Earlier
              recent={recent}
              onBack={() => setEarlier(false)}
              onReopen={(conversation) => show({ kind: 'earlier', ref: conversation.ref, title: conversation.title })}
            />
          )}
          {pick.kind !== 'dash' && source.chats && (
            <div className="flex min-h-0 flex-1 flex-col">
              <PaneChat
                key={pickId(pick)}
                pick={pick}
                chats={source.chats}
                draft={drafts.get(pickId(pick)) ?? ''}
                onDraft={(text) => drafts.set(pickId(pick), text)}
              />
            </div>
          )}
        </PaidCostsProvider>
      </aside>
    </div>
  );
}

function NewQuestion({
  ask,
  page,
  list,
  lookingAt,
  onStarted,
}: {
  ask?: string;
  page: string | null;
  list?: AskRows;
  lookingAt: React.ReactNode;
  onStarted: (ref: string) => void;
}) {
  const [asked, setAsked] = useState(Boolean(ask));
  const handle = useAskDash();
  const draft = handle?.draft;
  return (
    <>
      {/* The empty state, before the first question: Dash's mark and what he
          reads, the Dash page's opening at the sheet's size, gone once there
          is an answer to read instead. Rows sent from a list are said in his
          voice, since they are what he will read. */}
      {!asked && (
        <div className="pt-4">
          <DashWelcome
            compact
            line={
              list
                ? `I have ${list.label}, the ones you filtered to. Ask me about them, or to change or chart just them. Nothing is written until you confirm it.`
                : undefined
            }
          />
        </div>
      )}
      {/* Grows to the sheet's foot, so the box docks there before the first question as after it. */}
      <div className="flex flex-1 flex-col">
        <AskThread
          id="ask-dash"
          conversationRef={null}
          page={page}
          list={list}
          turns={[]}
          onConversation={onStarted}
          label={asked ? 'Ask a follow-up' : 'Ask a question'}
          placeholder={list ? ROWS_PLACEHOLDER[list.list] : 'Ask about your money, jobs, todos or notes'}
          dock
          ask={ask}
          initialDraft={draft}
          above={lookingAt}
          onSend={() => setAsked(true)}
        />
      </div>
    </>
  );
}

/**
 * Earlier questions, open in the sheet over Dash's chat (plan #2981): the
 * last few, each reopening in the sheet, with the way back to the chat that
 * was open and the way to all of them on Dash's page.
 */
function Earlier({
  recent,
  onBack,
  onReopen,
}: {
  recent: { conversations: ConversationSummary[]; error?: string } | null;
  onBack: () => void;
  onReopen: (conversation: ConversationSummary) => void;
}) {
  const now = useClockNow();
  return (
    <section aria-labelledby="ask-dash-earlier" className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-4 py-3">
      <button
        type="button"
        onClick={onBack}
        className="press-area -ml-1 flex w-fit items-center gap-1 rounded-control px-1 text-ui text-accent hover:underline"
      >
        <ArrowLeft className="size-4" strokeWidth={1.75} aria-hidden />
        Back to the chat
      </button>
      <SectionHeading
        as="h3"
        id="ask-dash-earlier"
        title="Earlier questions"
        action={
          <Link href="/chat/dash" className={cn(linkVariants({ tone: 'inline' }), 'press-area text-small')}>
            All of them
          </Link>
        }
      />
      {!recent ? (
        <p className="text-ui text-ink-muted" aria-live="polite">
          Reading your earlier questions…
        </p>
      ) : recent.error ? (
        <p className="text-ui text-danger">{recent.error}</p>
      ) : recent.conversations.length === 0 ? (
        <p className="text-ui text-ink-muted">Nothing asked yet. Your questions to Dash show here once you ask one.</p>
      ) : (
        <ul className="-mx-2 space-y-0.5">
          {recent.conversations.map((conversation) => (
            <li key={conversation.id}>
              <button
                type="button"
                onClick={() => onReopen(conversation)}
                className="press flex min-h-11 w-full items-center gap-3 rounded-control px-2 text-left transition-colors duration-quick hover:bg-sunken sm:min-h-9"
              >
                <MessageSquareText className="size-4 shrink-0 text-ink-muted" strokeWidth={1.75} aria-hidden />
                <span className="min-w-0 flex-1 truncate text-ui text-ink">
                  {conversation.title ?? 'A question'}
                </span>
                <time dateTime={conversation.lastAt} className="tabular shrink-0 text-small text-ink-muted">
                  {commentWhen(conversation.lastAt, now)}
                </time>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function EarlierQuestion({
  conversationRef,
  page,
  source,
  lookingAt,
}: {
  conversationRef: string;
  page: string | null;
  source: AskSource;
  lookingAt: React.ReactNode;
}) {
  const [loaded, setLoaded] = useState<OpenedAsk | null>(null);

  useEffect(() => {
    let live = true;
    source
      .open(conversationRef)
      .catch((): OpenedAsk => ({ turns: [], changes: [], error: 'That conversation could not be read. Try again.' }))
      .then((found) => {
        if (live) setLoaded(found);
      });
    return () => {
      live = false;
    };
  }, [conversationRef, source]);

  if (!loaded) {
    return (
      <p className="text-ui text-ink-muted" aria-live="polite">
        Reading the conversation…
      </p>
    );
  }
  if (loaded.error) return <p className="text-ui text-danger">{loaded.error}</p>;
  return (
    <>
      {loaded.changesError && <p className="text-ui text-danger">{loaded.changesError}</p>}
      <div className="flex flex-1 flex-col">
        <AskThread
          id={`ask-${conversationRef}`}
          conversationRef={conversationRef}
          page={page}
          turns={loaded.turns}
          changes={loaded.changes}
          openHandoffs={loaded.openHandoffs}
          reply={loaded.reply}
          label="Ask a follow-up"
          placeholder="Ask more about this"
          above={lookingAt}
          dock
        />
      </div>
    </>
  );
}

/**
 * The page Dash will be told about, above the question box (plan #1272),
 * with an × that stops it being sent for the rest of the sheet.
 */
export function LookingAt({
  label,
  onDrop,
  dropTitle = 'Do not tell Dash about this page',
}: {
  label: string;
  onDrop: () => void;
  dropTitle?: string;
}) {
  return (
    <p className="flex w-fit max-w-full items-center gap-0.5 rounded-control bg-sunken py-0.5 pl-2 pr-0.5 text-small text-ink-muted">
      <span className="min-w-0 truncate">
        Looking at: <span className="text-ink">{label}</span>
      </span>
      <Tooltip label={dropTitle} align="end" className="shrink-0">
        <IconButton label={dropTitle} size="sm" onClick={onDrop} className="hover:bg-surface">
          <X strokeWidth={1.75} aria-hidden />
        </IconButton>
      </Tooltip>
    </p>
  );
}
