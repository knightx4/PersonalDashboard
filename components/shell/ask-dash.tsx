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
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { SquarePen, X } from 'lucide-react';
import { DashMark } from '@/components/ui/dash-mark';
import { DashChanges, type ChangePresses } from '@/components/talk/dash-changes';
import { TalkThread, type TalkSend } from '@/components/talk/talk-thread';
import { PaidCostsProvider, PaidHint } from '@/components/ui/paid-hint';
import { scrim } from '@/components/ui/popover';
import { commentWhen } from '@/lib/comments/when';
import type { PaidCosts } from '@/lib/core/spend/paid-actions';
import { isAskPath, roughPageName } from '@/lib/ask/page-name';
import type { DashChange } from '@/lib/talk/changes';
import type { ConversationSummary } from '@/lib/talk/store';
import type { TalkTurn } from '@/lib/talk/talk';
import { useClockNow } from '@/lib/use-clock-now';
import {
  type OpenedAsk,
  askDashCosts,
  askDashPageLabel,
  askDashQuestion,
  confirmDashChange,
  declineDashChange,
  openAskQuestion,
  recentAskQuestions,
  undoDashChange,
} from '@/app/ask/actions';

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
 * `ask`), so the sheet opens on the last few and /ask lists them all; either
 * reopens one to carry on. Following a link in an answer closes the sheet,
 * since the page it goes to is what was asked for.
 *
 * The state is in a provider for the same reason as capture's
 * (components/shell/capture.tsx): opening it must not re-render the page, and
 * both the button and ⌘K need to open it.
 */

/**
 * Where the sheet reads and writes: the server actions in app/ask/actions.ts,
 * or typed fixtures in the surface gallery, which cannot sign in.
 */
export type AskSource = ChangePresses & {
  ask: typeof askDashQuestion;
  recent: typeof recentAskQuestions;
  open: typeof openAskQuestion;
  costs: typeof askDashCosts;
  label: typeof askDashPageLabel;
};

const ACTIONS: AskSource = {
  ask: askDashQuestion,
  recent: recentAskQuestions,
  open: openAskQuestion,
  costs: askDashCosts,
  label: askDashPageLabel,
  confirm: confirmDashChange,
  decline: declineDashChange,
  undo: undoDashChange,
};

type AskDashHandle = {
  /** Open the sheet on a new question, sending `question` at once when given. */
  open: (question?: string) => void;
  source: AskSource;
};

const AskDashContext = createContext<AskDashHandle | null>(null);

/**
 * The handle, or null outside the shell. Null rather than a throw so a search
 * box drawn on its own (the gallery, a test) simply has no Ask Dash row.
 */
export function useAskDash(): AskDashHandle | null {
  return useContext(AskDashContext);
}

const ACTION = 'app/ask/actions.ts#askDashQuestion';

/** One opening of the sheet; the key makes a fresh one on every open. */
type Session = { key: number; ask?: string };

/**
 * One sheet per page. A provider inside another stands down, so the gallery
 * can wrap the whole shell in one fed with fixtures and the shell's own
 * provider leaves the job to it.
 */
export function AskDashProvider({
  source,
  page,
  children,
}: {
  source?: AskSource;
  /** The address the sheet treats as the page, for the gallery; the real one otherwise. */
  page?: string;
  children: React.ReactNode;
}) {
  const outer = useContext(AskDashContext);
  if (outer) return <>{children}</>;
  return (
    <AskDashRoot source={source ?? ACTIONS} page={page}>
      {children}
    </AskDashRoot>
  );
}

function AskDashRoot({
  source,
  page,
  children,
}: {
  source: AskSource;
  page?: string;
  children: React.ReactNode;
}) {
  const [session, setSession] = useState<Session | null>(null);
  const opened = useRef(0);
  const open = useCallback((question?: string) => {
    opened.current += 1;
    const ask = question?.trim();
    setSession({ key: opened.current, ask: ask || undefined });
  }, []);
  const close = useCallback(() => setSession(null), []);
  const handle = useMemo<AskDashHandle>(() => ({ open, source }), [open, source]);

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
    <button
      type="button"
      onClick={() => handle.open()}
      title="Ask Dash"
      className="press flex size-8 shrink-0 items-center justify-center rounded-full text-shell-muted transition-colors hover:bg-shell-hover hover:text-shell-ink"
    >
      <DashMark size="icon" tone="brand" decorative />
      <span className="sr-only">Ask Dash</span>
    </button>
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
): TalkSend {
  const source = useAskDash()?.source ?? ACTIONS;
  const ref = useRef(initialRef);
  const heard = useRef({ onConversation, onChanges, page });
  useEffect(() => {
    heard.current = { onConversation, onChanges, page };
  });
  return useCallback<TalkSend>(async (body) => {
    const result = await source.ask(body, ref.current, heard.current.page);
    if (result.conversation && result.conversation.ref !== ref.current) {
      ref.current = result.conversation.ref;
      heard.current.onConversation?.(result.conversation.ref);
    }
    if (result.changes && result.changes.length > 0) heard.current.onChanges?.(result.changes);
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
  turns,
  changes: initialChanges = [],
  onConversation,
  onSend,
  ...thread
}: {
  id: string;
  conversationRef: string | null;
  /** The app address each question is asked from; null tells Dash no page. */
  page?: string | null;
  turns: readonly TalkTurn[];
  changes?: readonly DashChange[];
  onConversation?: (ref: string) => void;
  /** Heard on every question sent, before the answer comes. */
  onSend?: () => void;
  label: string;
  placeholder?: string;
  hint?: React.ReactNode;
  /** Just above the question box: the page Dash will be told (plan #1272). */
  above?: React.ReactNode;
  startWriting?: boolean;
  ask?: string;
}) {
  const source = useAskDash()?.source ?? ACTIONS;
  const [changes, setChanges] = useState<DashChange[]>([...initialChanges]);
  const send = useAskSend(conversationRef, page, onConversation, (added) =>
    setChanges((current) => [...current.filter((c) => !added.some((a) => a.id === c.id)), ...added]),
  );
  const onChanged = useCallback(
    (next: DashChange) => setChanges((current) => current.map((c) => (c.id === next.id ? next : c))),
    [],
  );
  const [today] = useState(localToday);

  const byTurn = useMemo(() => {
    const map = new Map<string, DashChange[]>();
    for (const change of changes) {
      if (!change.turnId) continue;
      map.set(change.turnId, [...(map.get(change.turnId) ?? []), change]);
    }
    return map;
  }, [changes]);

  return (
    <TalkThread
      id={id}
      turns={turns}
      send={(body) => {
        onSend?.();
        return send(body);
      }}
      waiting={ASK_WAITING}
      activity="searching"
      below={(turn) => {
        const mine = turn.role === 'assistant' ? byTurn.get(turn.id) : undefined;
        return mine ? (
          <DashChanges changes={mine} presses={source} onChanged={onChanged} today={today} />
        ) : null;
      }}
      {...thread}
    />
  );
}

/** What Dash says while it looks: long enough that the wait needs a reason. */
export const ASK_WAITING = 'Dash is looking it up. This can take up to twenty seconds.';

/** The sheet shows a new question, or an earlier one reopened. */
type View =
  | { kind: 'new'; ask?: string }
  | { kind: 'earlier'; ref: string; title: string | null };

type SheetProps = {
  ask?: string;
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
  // Bumped on every change of view, so the thread below starts afresh.
  const [threadKey, setThreadKey] = useState(0);
  // Whether the question on screen has become a conversation, which is when
  // "New question" has something to leave.
  const [started, setStarted] = useState(false);
  const [costs, setCosts] = useState<PaidCosts>({});

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
      // Escape in the box closes the box first (TalkThread), and marks the
      // event handled; only a second Escape closes the sheet.
      if (event.key === 'Escape' && !event.defaultPrevented) onClose();
    }
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  function show(next: View) {
    setView(next);
    setStarted(next.kind === 'earlier');
    setThreadKey((key) => key + 1);
  }

  const hint = <PaidHint action={ACTION} what="Cost of each answer from Dash" />;
  const lookingAt = page ? (
    <LookingAt label={pageLabel ?? roughPageName(page)} onDrop={() => setPage(null)} />
  ) : null;

  return (
    <div className="fixed inset-0 z-overlay">
      <button type="button" aria-label="Close Dash" onClick={onClose} className={scrim} />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="ask-dash-title"
        className="absolute inset-x-0 bottom-0 flex max-h-[85dvh] flex-col rounded-t-xl border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] md:inset-y-0 md:left-auto md:right-0 md:max-h-none md:w-[min(30rem,100vw)] md:rounded-none md:border-l md:border-t-0 md:pb-0"
      >
        <PaidCostsProvider costs={costs}>
          <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 id="ask-dash-title" className="text-ui font-semibold text-ink">
                  Ask Dash
                </h2>
                {hint}
              </div>
              {view.kind === 'earlier' && view.title && (
                <p className="mt-0.5 line-clamp-2 break-words text-ui text-ink-muted">
                  {view.title}
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              {started && (
                <button
                  type="button"
                  onClick={() => show({ kind: 'new' })}
                  title="New question"
                  className="press flex size-8 items-center justify-center rounded-lg text-ink-muted hover:bg-sunken hover:text-ink"
                >
                  <SquarePen className="size-4" strokeWidth={2} aria-hidden />
                  <span className="sr-only">New question</span>
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                className="press flex size-8 items-center justify-center rounded-lg text-ink-muted hover:bg-sunken hover:text-ink"
              >
                <X className="size-4" strokeWidth={2} aria-hidden />
                <span className="sr-only">Close Dash</span>
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">
            {view.kind === 'new' ? (
              <NewQuestion
                key={threadKey}
                ask={view.ask}
                page={page}
                source={source}
                hint={hint}
                lookingAt={lookingAt}
                onStarted={() => setStarted(true)}
                onReopen={(conversation) =>
                  show({ kind: 'earlier', ref: conversation.ref, title: conversation.title })
                }
              />
            ) : (
              <EarlierQuestion
                key={threadKey}
                conversationRef={view.ref}
                page={page}
                source={source}
                hint={hint}
                lookingAt={lookingAt}
              />
            )}
          </div>
        </PaidCostsProvider>
      </aside>
    </div>
  );
}

function NewQuestion({
  ask,
  page,
  source,
  hint,
  lookingAt,
  onStarted,
  onReopen,
}: {
  ask?: string;
  page: string | null;
  source: AskSource;
  hint: React.ReactNode;
  lookingAt: React.ReactNode;
  onStarted: () => void;
  onReopen: (conversation: ConversationSummary) => void;
}) {
  const [asked, setAsked] = useState(Boolean(ask));
  const [recent, setRecent] = useState<{ conversations: ConversationSummary[]; error?: string } | null>(
    null,
  );

  useEffect(() => {
    let live = true;
    source
      .recent()
      .catch(() => ({ conversations: [], error: 'Your earlier questions could not be read.' }))
      .then((found) => {
        if (live) setRecent(found);
      });
    return () => {
      live = false;
    };
  }, [source]);

  return (
    <>
      {/* The empty state: said once, before the first question, and gone
          once there is an answer to read instead. */}
      {!asked && (
        <div className="flex gap-2">
          <div className="flex w-4 shrink-0 justify-center pt-1">
            <DashMark size="2xs" decorative className="text-ink-ghost" />
          </div>
          <div className="min-w-0 flex-1 space-y-0.5">
            <span className="text-small font-semibold text-ink">Dash</span>
            <p className="text-body text-ink">
              Ask me about anything in here: what you spent, who has not replied, what you wrote
              about something. I look it up in your own things and link what I used. I can also add
              a todo, add a step to a goal or mark a return sent back, and nothing is written until
              you confirm it.
            </p>
          </div>
        </div>
      )}

      <AskThread
        id="ask-dash"
        conversationRef={null}
        page={page}
        turns={[]}
        onConversation={onStarted}
        label={asked ? 'Ask a follow-up' : 'Ask a question'}
        placeholder="What did I spend on eBay this month?"
        startWriting
        ask={ask}
        hint={hint}
        above={lookingAt}
        onSend={() => setAsked(true)}
      />

      {!asked && <Earlier recent={recent} onReopen={onReopen} />}
    </>
  );
}

/** The last few questions, under a new one, each reopening in the sheet. */
function Earlier({
  recent,
  onReopen,
}: {
  recent: { conversations: ConversationSummary[]; error?: string } | null;
  onReopen: (conversation: ConversationSummary) => void;
}) {
  const now = useClockNow();
  if (!recent) return null;
  if (recent.error) return <p className="text-ui text-danger">{recent.error}</p>;
  // A first visit has nothing earlier, and says nothing about it.
  if (recent.conversations.length === 0) return null;
  return (
    <section aria-labelledby="ask-dash-earlier" className="pt-2">
      <div className="flex items-baseline justify-between gap-3">
        <h3 id="ask-dash-earlier" className="text-small font-semibold text-ink-muted">
          Earlier questions
        </h3>
        <Link href="/ask" className="text-small text-accent underline-offset-2 hover:underline">
          All of them
        </Link>
      </div>
      <ul className="mt-1 divide-y divide-border">
        {recent.conversations.map((conversation) => (
          <li key={conversation.id}>
            <button
              type="button"
              onClick={() => onReopen(conversation)}
              className="flex w-full items-baseline gap-3 py-2 text-left hover:text-accent"
            >
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
    </section>
  );
}

function EarlierQuestion({
  conversationRef,
  page,
  source,
  hint,
  lookingAt,
}: {
  conversationRef: string;
  page: string | null;
  source: AskSource;
  hint: React.ReactNode;
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
      <AskThread
        id={`ask-${conversationRef}`}
        conversationRef={conversationRef}
        page={page}
        turns={loaded.turns}
        changes={loaded.changes}
        label="Ask a follow-up"
        placeholder="Ask more about this"
        hint={hint}
        above={lookingAt}
      />
    </>
  );
}

/**
 * The page Dash will be told about, above the question box (plan #1272),
 * with an × that stops it being sent for the rest of the sheet.
 */
export function LookingAt({ label, onDrop }: { label: string; onDrop: () => void }) {
  return (
    <p className="flex w-fit max-w-full items-center gap-0.5 rounded-control bg-sunken py-0.5 pl-2 pr-0.5 text-small text-ink-muted">
      <span className="min-w-0 truncate">
        Looking at: <span className="text-ink">{label}</span>
      </span>
      <button
        type="button"
        onClick={onDrop}
        title="Do not tell Dash about this page"
        className="press flex size-6 shrink-0 items-center justify-center rounded-control hover:bg-surface hover:text-ink"
      >
        <X className="size-3.5" strokeWidth={2} aria-hidden />
        <span className="sr-only">Do not tell Dash about this page</span>
      </button>
    </p>
  );
}
