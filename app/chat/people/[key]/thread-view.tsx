'use client';

import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowUp } from 'lucide-react';
import {
  MessageBubble,
  MessageCard,
  MessageDay,
  MessageGroup,
  MessageLink,
  MessageNote,
  MessagingThread,
  PersonMark,
  TypingBubble,
} from '@/components/patterns/messaging';
import { prefersReducedMotion } from '@/components/motion/reduced';
import { Button, buttonVariants } from '@/components/ui/button';
import Link from '@/components/ui/link';
import { Input } from '@/components/ui/field';
import { Tooltip } from '@/components/ui/tooltip';
import { createClient } from '@/lib/auth/client';
import { cn } from '@/lib/cn';
import { EASE, MOTION_MS } from '@/lib/motion';
import { MESSAGE_MAX } from '@/lib/you/council-model';
import {
  isTyping,
  mergeMessages,
  personInitials,
  receiptOf,
  replyFailedOf,
  threadBlocks,
  threadDetail,
  threadMessageOf,
  type PersonRow,
  type ThreadMessage,
  type ThreadPage,
} from '@/lib/you/chat-threads-model';
import { editHref } from '@/lib/you/people-cards-model';
import { placeAfterReplies, withItem } from '@/lib/you/thread-cards';
import { DashChanges, type ChangePresses } from '@/components/talk/dash-changes';
import type { DashChange } from '@/lib/talk/changes';

/**
 * One thread on the People tab (plan #2748.6): every message with one person,
 * oldest at the top, grouped by sender under the day it was sent.
 *
 * - It opens with the newest fifty and pages back fifty at a time when you
 *   scroll to the top, keeping your place.
 * - What you send shows the moment you press send, before the server
 *   answers; a send that fails stays in the thread, marked, with Retry.
 * - The mentor's messages and the receipts on yours (Delivered, then Read)
 *   arrive over Realtime on you.advisor_messages, and their typing on
 *   you.advisor_chats.typing_until, so nothing waits for a reload.
 * - The reply is written on the server, so leaving does not stop it; one
 *   that failed (advisor_chats.reply_status) says so under your message,
 *   with Try again (plan #2854.4).
 * - What they did when you asked (plan #2854.2.1), a todo added or a build
 *   or delete proposed, is a card after their reply to the text that asked:
 *   a change made carries Undo, a proposal writes nothing until Confirm.
 *   The cards are read again whenever a text of theirs comes in.
 */

export type ThreadActions = {
  /** The page before a message's created_at. */
  older: (chatId: string, before: string) => Promise<ThreadPage | { error: string }>;
  /** Reading the thread, as having it open does. */
  read: (chatId: string, advisorId: string) => Promise<void>;
  /** Try again on a reply that failed (plan #2854.4): the mentor answers your last message once more. */
  retryReply?: (chatId: string, advisorId: string) => Promise<{ error: string | null }>;
  /** The thread's changes as they now stand, or null when they could not be read. */
  changes?: (chatId: string) => Promise<DashChange[] | null>;
};

/** What the gallery reads with: nothing further back, and reading and trying again change nothing. */
const NO_ACTIONS: ThreadActions = {
  older: async () => ({ messages: [], hasOlder: false }),
  read: async () => {},
  retryReply: async () => ({ error: null }),
};

/** The gallery's presses: each answers with the change as the press would leave it. */
const NO_PRESSES: ChangePresses = {
  confirm: async () => ({ ok: false, error: 'Nothing is written in the gallery.', change: null }),
  decline: async () => ({ ok: false, error: 'Nothing is written in the gallery.', change: null }),
  undo: async () => ({ ok: false, error: 'Nothing is written in the gallery.', change: null }),
};

type Pending = { id: string; text: string; at: string; failed: string | null };

/** A message as it stands the moment you press send. */
function newPending(text: string): Pending {
  const at = new Date();
  return { id: `pending-${at.getTime()}-${Math.random().toString(36).slice(2, 6)}`, text, at: at.toISOString(), failed: null };
}

/** Within this many pixels of the foot, a new message keeps the thread at the foot. */
const NEAR_FOOT_PX = 120;
/** Within this many pixels of the top, the page before is read. */
const NEAR_TOP_PX = 80;

/**
 * No changes, as one array: a fresh `[]` default on every draw made the
 * redraw check below see new changes each time and draw again without end.
 */
const NO_CHANGES: DashChange[] = [];

export function ThreadView({
  person,
  chatId: initialChatId,
  page,
  typingUntil: initialTyping,
  timezone,
  now: start,
  actions = NO_ACTIONS,
  live = true,
  pending: initialPending = [],
  loadingOlder: initialLoadingOlder = false,
  changes: initialChanges = NO_CHANGES,
  presses = NO_PRESSES,
  today,
  nextText = null,
}: {
  person: PersonRow;
  chatId: string | null;
  page: ThreadPage;
  typingUntil: string | null;
  timezone: string;
  now: number;
  /** The server's presses; the gallery, which has no server, leaves them out. */
  actions?: ThreadActions;
  /** False in the gallery, which has no database to listen to. */
  live?: boolean;
  /** Messages still being sent, for the gallery. */
  pending?: Pending[];
  /** The page before is being read, for the gallery. */
  loadingOlder?: boolean;
  /** What they made or proposed in this thread, oldest first (loadPeopleChanges). */
  changes?: DashChange[];
  /** Confirm, decline and undo on those changes: Ask's own, in app/chat/dash/actions.ts. */
  presses?: ChangePresses;
  /** YYYY-MM-DD in the person's zone, so a due date this year leaves the year off. */
  today?: string;
  /** "Next text Monday, if there is something new", for someone with a reach-out rule (plan #2931.3). */
  nextText?: string | null;
}) {
  const [startedChatId, setChatId] = useState<string | null>(null);
  const chatId = initialChatId ?? startedChatId;
  // What this view has heard or read beyond the page the server drew: older
  // pages, Realtime rows and what you sent. A server redraw (the list hearing
  // a change) brings a fresher page, and the two are merged by id.
  const [heard, setMessages] = useState<ThreadMessage[]>([]);
  const messages = mergeMessages(page.messages, heard);
  // What was on screen when the thread opened, and what older pages added, never rises in; a text of theirs after that does.
  const [openingIds] = useState(() => new Set(page.messages.map((m) => m.id)));
  const [olderIds, setOlderIds] = useState<ReadonlySet<string>>(new Set());
  const arrives = (m: ThreadMessage) => m.role === 'advisor' && !openingIds.has(m.id) && !olderIds.has(m.id);
  const [olderState, setHasOlder] = useState<boolean | null>(null);
  const hasOlder = olderState ?? page.hasOlder;
  const [loadingOlder, setLoadingOlder] = useState(initialLoadingOlder);
  const [olderError, setOlderError] = useState<string | null>(null);
  // Typing as Realtime last said, or as the server drew it before Realtime has spoken.
  const [heardTyping, setTypingUntil] = useState<string | null | undefined>(undefined);
  const typingUntil = heardTyping === undefined ? initialTyping : heardTyping;
  const [pending, setPending] = useState<Pending[]>(initialPending);
  // Why the reply failed, as Realtime last said or as the server drew it (plan #2854.4).
  const [heardFailed, setReplyFailed] = useState<string | null | undefined>(undefined);
  const replyFailed = heardFailed === undefined ? (person.replyFailed ?? null) : heardFailed;
  const [retryError, setRetryError] = useState<string | null>(null);
  // The changes as the server drew them, then as a press or a re-read left them.
  const [changes, setChanges] = useState<DashChange[]>(initialChanges);
  const [drawnChanges, setDrawnChanges] = useState(initialChanges);
  if (initialChanges !== drawnChanges) {
    setDrawnChanges(initialChanges);
    setChanges(initialChanges);
  }
  const onChanged = useCallback((change: DashChange) => setChanges((list) => withItem(list, change)), []);
  const [draft, setDraft] = useState('');
  const [now, setNow] = useState(start);
  const scroller = useRef<HTMLDivElement | null>(null);
  const keepFrom = useRef<number | null>(null);
  // A thread drawn at its oldest page, as the gallery's loading state is, starts at the top.
  const atFoot = useRef(!initialLoadingOlder);
  // The actions as last drawn, so a server redraw does not restart the listening.
  const act = useRef(actions);
  useEffect(() => {
    act.current = actions;
  }, [actions]);

  // Having the thread open reads it. A phone on /chat draws the newest
  // thread hidden behind the list, and that one is not read.
  const shown = () => scroller.current?.checkVisibility?.() ?? true;

  // Realtime: the thread's messages and its typing.
  useEffect(() => {
    if (!live || !chatId) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`chat-thread:${chatId}:${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'you', table: 'advisor_messages', filter: `chat_id=eq.${chatId}` }, (event) => {
        const row = threadMessageOf((event.new ?? {}) as Record<string, unknown>);
        if (!row) return;
        setMessages((list) => mergeMessages(list, [row]));
        if (row.role === 'advisor' && !row.readAt && shown()) void act.current.read(chatId, person.id);
        // A text of theirs may be the reply to something they did: read the cards again.
        if (row.role === 'advisor' && event.eventType === 'INSERT') {
          void act.current.changes?.(chatId).then((next) => next && setChanges(next));
        }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'you', table: 'advisor_chats', filter: `id=eq.${chatId}` }, (event) => {
        const next = (event.new ?? {}) as Record<string, unknown>;
        setTypingUntil(typeof next.typing_until === 'string' ? next.typing_until : null);
        if ('reply_status' in next) setReplyFailed(replyFailedOf(next));
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [live, chatId, person.id]);

  useEffect(() => {
    if (live && chatId && scroller.current?.checkVisibility?.() !== false) void act.current.read(chatId, person.id);
  }, [live, chatId, person.id]);

  // Typing ends on its own clock.
  useEffect(() => {
    if (!live || !typingUntil) return;
    const wait = Date.parse(typingUntil) - Date.now();
    const timer = setTimeout(() => setNow(Date.now()), Math.max(wait + 50, 50));
    return () => clearTimeout(timer);
  }, [live, typingUntil]);

  // Start at the foot; after older messages arrive, stay where you were.
  // When the foot moves because dots or a text came in, what is already there
  // slides up to its place rather than jumping (the moment "A mentor typing").
  const footSeen = useRef<{ height: number; kids: WeakSet<Element> } | null>(null);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const seen = footSeen.current;
    if (keepFrom.current !== null) {
      el.scrollTop = el.scrollHeight - keepFrom.current;
      keepFrom.current = null;
    } else if (atFoot.current) {
      el.scrollTop = el.scrollHeight;
      const moved = seen ? el.scrollHeight - seen.height : 0;
      if (seen && moved !== 0 && !prefersReducedMotion() && typeof el.animate === 'function') {
        for (const kid of Array.from(el.children)) {
          if (!seen.kids.has(kid)) continue;
          kid.animate([{ transform: `translateY(${moved}px)` }, { transform: 'none' }], {
            duration: MOTION_MS.move,
            easing: EASE.outSoft,
          });
        }
      }
    }
    footSeen.current = { height: el.scrollHeight, kids: new WeakSet(Array.from(el.children)) };
  }, [messages, pending, typingUntil]);

  const loadOlder = useCallback(async () => {
    const el = scroller.current;
    const first = messages[0];
    if (!chatId || !first || !hasOlder || loadingOlder) return;
    setLoadingOlder(true);
    setOlderError(null);
    const result = await act.current.older(chatId, first.createdAt);
    if ('error' in result) {
      setOlderError(result.error);
    } else {
      keepFrom.current = el ? el.scrollHeight - el.scrollTop : null;
      setOlderIds((ids) => new Set([...ids, ...result.messages.map((m) => m.id)]));
      setMessages((list) => mergeMessages(result.messages, list));
      setHasOlder(result.hasOlder);
    }
    setLoadingOlder(false);
  }, [chatId, hasOlder, loadingOlder, messages]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    atFoot.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_FOOT_PX;
    if (el.scrollTop < NEAR_TOP_PX) void loadOlder();
  };

  const send = async (item: Pending) => {
    atFoot.current = true;
    try {
      const res = await fetch('/api/chat/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ advisorId: person.id, text: item.text }),
      });
      const body = (await res.json().catch(() => null)) as { chatId?: string; messageId?: string; error?: string } | null;
      if (!res.ok || !body?.messageId || !body.chatId) {
        setPending((list) => list.map((p) => (p.id === item.id ? { ...p, failed: body?.error ?? 'Not sent.' } : p)));
        return;
      }
      const sent: ThreadMessage = {
        id: body.messageId,
        chatId: body.chatId,
        role: 'person',
        kind: 'reply',
        text: item.text,
        receipts: [],
        createdAt: item.at,
        deliveredAt: null,
        readAt: null,
      };
      // The row Realtime sends carries the server's time and receipts, and replaces this copy by id.
      setMessages((list) => mergeMessages(list, [sent]));
      setPending((list) => list.filter((p) => p.id !== item.id));
      if (!chatId) setChatId(body.chatId);
      // The mentor is typing from the moment the send answers, before Realtime says so.
      setTypingUntil((t) => t ?? new Date(Date.now() + 15_000).toISOString());
    } catch {
      setPending((list) => list.map((p) => (p.id === item.id ? { ...p, failed: 'Not sent. Check your connection.' } : p)));
    }
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || !person.canTalk) return;
    const item = newPending(text);
    setPending((list) => [...list, item]);
    setDraft('');
    void send(item);
  };

  const retry = (item: Pending) => {
    const again = { ...item, failed: null };
    setPending((list) => list.map((p) => (p.id === item.id ? again : p)));
    void send(again);
  };

  const retryReply = async () => {
    const tryAgain = act.current.retryReply;
    if (!chatId || !tryAgain) return;
    setReplyFailed(null);
    setRetryError(null);
    atFoot.current = true;
    setTypingUntil(new Date(Date.now() + 15_000).toISOString());
    const outcome = await tryAgain(chatId, person.id).catch(() => ({ error: 'Not sent. Check your connection.' }));
    if (outcome.error) {
      setTypingUntil(null);
      setRetryError(outcome.error);
    }
  };

  const typing = isTyping(typingUntil, now);
  const blocks = threadBlocks(messages, { timeZone: timezone, now });
  const receipt = pending.length === 0 ? receiptOf(messages) : null;
  const cards = placeAfterReplies(messages, changes, (change) => change.advisorMessageId);
  const empty = messages.length === 0 && pending.length === 0;
  // A failed reply is said under your last message, while nothing newer is on its way.
  const failedNote =
    !typing && pending.length === 0 && messages.at(-1)?.role === 'person' ? (retryError ?? replyFailed) : null;

  return (
    <MessagingThread
      name={person.name}
      detail={nextText && person.canTalk ? nextText : threadDetail(person)}
      avatar={<PersonMark initials={personInitials(person.name)} colour={person.colour} size="sm" />}
      back={{ href: '/chat', label: 'Messages' }}
      crumbs={[{ label: 'Messages', href: '/chat' }, { label: person.name, href: `/chat/people/${person.key}` }]}
      actions={
        <Link href={editHref(person.key)} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
          Edit
        </Link>
      }
      scrollRef={scroller}
      onScroll={onScroll}
      box={
        <form onSubmit={submit} className="flex items-center gap-2">
          <Input
            aria-label={`Message ${person.name}`}
            placeholder={person.canTalk ? 'Message' : 'Not ready to talk yet'}
            value={draft}
            maxLength={MESSAGE_MAX}
            disabled={!person.canTalk}
            onChange={(e) => setDraft(e.target.value)}
            className="flex-1 rounded-pill border-border bg-sunken max-sm:min-h-11"
            enterKeyHint="send"
          />
          <Tooltip label="Send">
            <Button type="submit" aria-label="Send" disabled={!person.canTalk || !draft.trim()} className="size-(--control-h) rounded-pill px-0">
              <ArrowUp className="size-4" strokeWidth={1.75} aria-hidden />
            </Button>
          </Tooltip>
        </form>
      }
    >
      {hasOlder && (
        <p className="mb-2 self-center text-small text-ink-muted" aria-live="polite">
          {loadingOlder ? (
            'Loading earlier messages…'
          ) : olderError ? (
            <>
              {olderError}{' '}
              <button type="button" onClick={() => void loadOlder()} className="text-accent hover:underline">
                Try again
              </button>
            </>
          ) : (
            <button type="button" onClick={() => void loadOlder()} className="text-accent hover:underline">
              Show earlier messages
            </button>
          )}
        </p>
      )}
      {empty && <EmptyThread person={person} />}
      {blocks.map((block) =>
        block.kind === 'day' ? (
          <MessageDay key={block.key}>{block.label}</MessageDay>
        ) : (
          <MessageGroup key={block.key} from={block.from}>
            {block.messages.map((m, i) => (
              <Fragment key={m.id}>
                {/* A card under a bubble carries on the run, so the bubble keeps its corner tucked. */}
                <MessageBubble from={block.from} last={i === block.messages.length - 1 && !cards.has(m.id)} arriving={arrives(m)}>
                  {m.text}
                </MessageBubble>
                {m.receipts.map((r) => (
                  <MessageLink key={`${r.link}-${r.label}`} href={r.link}>
                    {r.label}
                  </MessageLink>
                ))}
                {cards.has(m.id) && (
                  <MessageCard>
                    <DashChanges changes={cards.get(m.id) ?? []} presses={presses} onChanged={onChanged} today={today} by={person.name} inThread />
                  </MessageCard>
                )}
              </Fragment>
            ))}
            {receipt && block.messages.at(-1)?.id === receipt.id && <MessageNote>{receipt.label}</MessageNote>}
          </MessageGroup>
        ),
      )}
      {pending.length > 0 && (
        <MessageGroup from="you">
          {pending.map((p, i) => (
            <div key={p.id} className="flex flex-col items-end">
              <span className={cn(p.failed && 'opacity-60')}>
                <MessageBubble from="you" last={i === pending.length - 1}>
                  {p.text}
                </MessageBubble>
              </span>
              {p.failed ? (
                <MessageNote tone="danger">
                  {p.failed}{' '}
                  <button type="button" onClick={() => retry(p)} className="font-medium text-accent hover:underline">
                    Retry
                  </button>
                </MessageNote>
              ) : (
                i === pending.length - 1 && <MessageNote>Sending…</MessageNote>
              )}
            </div>
          ))}
        </MessageGroup>
      )}
      {failedNote && (
        <div role="alert" className="flex flex-col items-start">
          <MessageNote tone="danger">
            {failedNote}
            {actions.retryReply && chatId && (
              <>
                {' '}
                <button type="button" onClick={() => void retryReply()} className="font-medium text-accent hover:underline">
                  Try again
                </button>
              </>
            )}
          </MessageNote>
        </div>
      )}
      {typing && <TypingBubble name={person.name} />}
    </MessagingThread>
  );
}

function EmptyThread({ person }: { person: PersonRow }) {
  return (
    <div className="my-auto flex flex-col items-center gap-2 px-4 py-8 text-center">
      <PersonMark initials={personInitials(person.name)} colour={person.colour} size="lg" />
      <p className="mt-1 text-body font-semibold text-ink">{person.name}</p>
      <p className="max-w-xs text-ui text-ink-muted">
        {person.canTalk
          ? `Nothing said yet. Write to ${person.name} below and they reply in a few seconds.`
          : `${person.name} can talk once Dash has finished reading their work.`}
      </p>
    </div>
  );
}
