'use client';

import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowUp } from 'lucide-react';
import { useRouter } from 'next/navigation';
import {
  MessageBubble,
  MessageDay,
  MessageGroup,
  MessageLink,
  MessageNote,
  MessagingThread,
  TypingBubble,
} from '@/components/patterns/messaging';
import { Button, buttonVariants } from '@/components/ui/button';
import { MessageInput } from '@/components/patterns/message-input';
import Link from '@/components/ui/link';
import { Tooltip } from '@/components/ui/tooltip';
import { MessageCharts } from '@/components/talk/reply-chart';
import { createClient } from '@/lib/auth/client';
import { cn } from '@/lib/cn';
import { MESSAGE_MAX } from '@/lib/you/council-model';
import { mergeMessages, replyFailedOf, threadBlocks, threadMessageOf, type ThreadMessage } from '@/lib/you/chat-threads-model';
import { owedGroupReply, STALLED_LIMIT_MS, STALLED_MS } from '@/lib/you/reply-turn';
import {
  firstName,
  groupDetailOf,
  groupHref,
  groupSettingsHref,
  isReaction,
  speakerOf,
  type GroupMember,
  type Reacted,
} from '@/lib/you/group-chats-model';
import { GroupMark, Reactions } from '../../group-parts';
import { SpeakRun, VoicedBubble } from '../../people/[key]/thread-view';
import { SpeakingPill, useSpeakArrivals } from '@/components/talk/speak-reply';
import { unlockSpeechOutput } from '@/lib/talk/speech/output';

/**
 * A group chat on the Messages tab (plan #2879.1.3): the person and two to
 * eight bots. Each bot's run of messages carries its name in its colour, a
 * bot's tap back sits on the edge of the bubble it reacted to, and each bot
 * typing shows its own dots with its name. The bots' messages, reactions
 * and typing arrive over Realtime (you.advisor_messages,
 * you.advisor_message_reactions, you.advisor_chat_members.typing_until).
 * Sending goes through POST /api/chat/groups/[id]/messages; the director
 * decides who answers, so nothing claims a bot is typing until one is.
 *
 * A burst that failed (advisor_chats.reply_status) says why under your last
 * text, with Try again, and a text of yours left a minute with no burst
 * holding the chat and no bot typing asks the group once more, as Try again
 * would (plan #2988.3).
 */

export type GroupThreadActions = {
  older: (chatId: string, before: string) => Promise<{ messages: ThreadMessage[]; hasOlder: boolean; reactions: Record<string, Reacted[]> } | { error: string }>;
  read: (chatId: string) => Promise<void>;
  /** Ask the group to answer your newest text again; `stalled` for the safety net rather than a press. */
  retryReply?: (chatId: string, options?: { stalled?: boolean }) => Promise<{ error: string | null }>;
};

const NO_ACTIONS: GroupThreadActions = {
  older: async () => ({ messages: [], hasOlder: false, reactions: {} }),
  read: async () => {},
  retryReply: async () => ({ error: null }),
};

type Pending = { id: string; text: string; at: string; failed: string | null };

/** A message as it stands the moment you press send. */
function newPending(text: string): Pending {
  const at = new Date();
  return { id: `pending-${at.getTime()}-${Math.random().toString(36).slice(2, 6)}`, text, at: at.toISOString(), failed: null };
}

/** How long ago a time was, read when an effect runs rather than during render. */
function ageOf(at: string): number {
  return Date.now() - Date.parse(at);
}

const NEAR_FOOT_PX = 120;
const NEAR_TOP_PX = 80;

export type GroupThreadProps = {
  chatId: string;
  title: string;
  members: GroupMember[];
  former: GroupMember[];
  /** The chat's lease, held while a burst works, as the server drew it. */
  typingUntil?: string | null;
  /** Why the last burst failed, as the server drew it; null when it did not. */
  replyFailed?: string | null;
  page: { messages: ThreadMessage[]; hasOlder: boolean; reactions: Record<string, Reacted[]> };
  timezone: string;
  now: number;
  actions?: GroupThreadActions;
  live?: boolean;
  /** For the gallery: messages still being sent. */
  pending?: Pending[];
  /** Drawn in the Ask Dash pane (plan #2981), which names the group in its own header. */
  bare?: boolean;
  /** What the box opens with, unsent: the pane keeps each thread's words while another is open. */
  initialDraft?: string;
  /** Told each change to the box's words, so the pane can keep them. */
  onDraftChange?: (text: string) => void;
};

export function GroupThreadView({
  chatId,
  title,
  members: firstMembers,
  former,
  typingUntil: initialLease = null,
  replyFailed: initialFailed = null,
  page,
  timezone,
  now: start,
  actions = NO_ACTIONS,
  live = true,
  pending: initialPending = [],
  bare = false,
  initialDraft = '',
  onDraftChange,
}: GroupThreadProps) {
  const [heard, setHeard] = useState<ThreadMessage[]>([]);
  const messages = mergeMessages(page.messages, heard);
  const [extraReactions, setReactions] = useState<Record<string, Reacted[]>>({});
  const reactions = { ...page.reactions, ...extraReactions };
  const [typing, setTyping] = useState<Record<string, string | null>>({});
  const members = firstMembers.map((m) => (m.id in typing ? { ...m, typingUntil: typing[m.id] } : m));
  const [openingIds] = useState(() => new Set(page.messages.map((m) => m.id)));
  const [openedThrough] = useState(() => page.messages.reduce((latest, m) => (m.createdAt > latest ? m.createdAt : latest), ''));
  const [hasOlderState, setHasOlder] = useState<boolean | null>(null);
  const hasOlder = hasOlderState ?? page.hasOlder;
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState<string | null>(null);
  // The lease and why a burst failed, as Realtime last said, or as the server drew them.
  const [heardLease, setLease] = useState<string | null | undefined>(undefined);
  const [heardFailed, setReplyFailed] = useState<string | null | undefined>(undefined);
  const [drawnReply, setDrawnReply] = useState({ lease: initialLease, failed: initialFailed });
  if (drawnReply.lease !== initialLease || drawnReply.failed !== initialFailed) {
    setDrawnReply({ lease: initialLease, failed: initialFailed });
    setLease(undefined);
    setReplyFailed(undefined);
  }
  const lease = heardLease === undefined ? initialLease : heardLease;
  const replyFailed = heardFailed === undefined ? initialFailed : heardFailed;
  const [retryError, setRetryError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending[]>(initialPending);
  const [draft, setDraftText] = useState(initialDraft);
  const setDraft = (text: string) => {
    setDraftText(text);
    onDraftChange?.(text);
  };
  const [now, setNow] = useState(start);
  const scroller = useRef<HTMLDivElement | null>(null);
  const keepFrom = useRef<number | null>(null);
  const atFoot = useRef(true);
  const act = useRef(actions);
  useEffect(() => {
    act.current = actions;
  }, [actions]);

  // Realtime does not replay what it missed while the phone slept or the
  // socket dropped, so the page is read again when the channel joins again or
  // the tab comes back (plan #2988).
  const router = useRouter();
  useEffect(() => {
    if (!live) return;
    const supabase = createClient();
    let joined = 0;
    const channel = supabase
      .channel(`chat-group:${chatId}:${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'you', table: 'advisor_messages', filter: `chat_id=eq.${chatId}` }, (event) => {
        const row = threadMessageOf((event.new ?? {}) as Record<string, unknown>);
        if (!row) return;
        setHeard((list) => mergeMessages(list, [row]));
        if (row.role === 'advisor') void act.current.read(chatId);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'you', table: 'advisor_chat_members', filter: `chat_id=eq.${chatId}` }, (event) => {
        const next = (event.new ?? {}) as Record<string, unknown>;
        if (typeof next.advisor_id !== 'string') return;
        setTyping((t) => ({ ...t, [next.advisor_id as string]: typeof next.typing_until === 'string' ? next.typing_until : null }));
        setNow(Date.now());
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'you', table: 'advisor_chats', filter: `id=eq.${chatId}` }, (event) => {
        const next = (event.new ?? {}) as Record<string, unknown>;
        setLease(typeof next.typing_until === 'string' ? next.typing_until : null);
        if ('reply_status' in next) setReplyFailed(replyFailedOf(next));
        setNow(Date.now());
      })
      .on('postgres_changes', { event: '*', schema: 'you', table: 'advisor_message_reactions' }, (event) => {
        const next = (event.new ?? {}) as Record<string, unknown>;
        if (typeof next.message_id !== 'string' || typeof next.advisor_id !== 'string' || !isReaction(next.reaction)) return;
        const messageId = next.message_id;
        const reacted: Reacted = { advisorId: next.advisor_id, reaction: next.reaction };
        setReactions((r) => ({ ...r, [messageId]: [...(r[messageId] ?? page.reactions[messageId] ?? []).filter((x) => x.advisorId !== reacted.advisorId), reacted] }));
      })
      .subscribe((status) => {
        if (status !== 'SUBSCRIBED') return;
        joined += 1;
        if (joined > 1) router.refresh();
      });
    const back = () => {
      if (document.visibilityState === 'visible') router.refresh();
    };
    document.addEventListener('visibilitychange', back);
    window.addEventListener('online', back);
    return () => {
      document.removeEventListener('visibilitychange', back);
      window.removeEventListener('online', back);
      void supabase.removeChannel(channel);
    };
  }, [live, chatId, page.reactions, router]);

  useEffect(() => {
    if (live) void act.current.read(chatId);
  }, [live, chatId]);

  // Each bot's dots end on their own clock, and the lease on its own.
  const soonest = [...members.map((m) => m.typingUntil), lease]
    .map((until) => (until ? Date.parse(until) : NaN))
    .filter((t) => Number.isFinite(t) && t > now)
    .sort((a, b) => a - b)[0];
  useEffect(() => {
    if (!live || !soonest) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.max(soonest - Date.now() + 50, 50));
    return () => clearTimeout(timer);
  }, [live, soonest]);

  const typingMembers = members.filter((m) => m.typingUntil && Date.parse(m.typingUntil) > now);
  const leaseHeld = lease !== null && Date.parse(lease) > now;

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (keepFrom.current !== null) {
      el.scrollTop = el.scrollHeight - keepFrom.current;
      keepFrom.current = null;
    } else if (atFoot.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages.length, pending.length, typingMembers.length]);

  const loadOlder = async () => {
    const el = scroller.current;
    const first = messages[0];
    if (!first || !hasOlder || loadingOlder) return;
    setLoadingOlder(true);
    setOlderError(null);
    const result = await act.current.older(chatId, first.createdAt);
    if ('error' in result) {
      setOlderError(result.error);
    } else {
      keepFrom.current = el ? el.scrollHeight - el.scrollTop : null;
      setHeard((list) => mergeMessages(result.messages, list));
      setReactions((r) => ({ ...result.reactions, ...r }));
      setHasOlder(result.hasOlder);
    }
    setLoadingOlder(false);
  };

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    atFoot.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_FOOT_PX;
    if (el.scrollTop < NEAR_TOP_PX) void loadOlder();
  };

  const send = async (item: Pending) => {
    atFoot.current = true;
    try {
      const res = await fetch(`/api/chat/groups/${chatId}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: item.text }),
      });
      const body = (await res.json().catch(() => null)) as { messageId?: string; error?: string } | null;
      if (!res.ok || !body?.messageId) {
        setPending((list) => list.map((p) => (p.id === item.id ? { ...p, failed: body?.error ?? 'Not sent.' } : p)));
        return;
      }
      const sent: ThreadMessage = {
        id: body.messageId,
        chatId,
        role: 'person',
        kind: 'reply',
        text: item.text,
        receipts: [],
        createdAt: item.at,
        deliveredAt: null,
        readAt: null,
        speakerId: null,
      };
      setHeard((list) => mergeMessages(list, [sent]));
      setPending((list) => list.filter((p) => p.id !== item.id));
    } catch {
      setPending((list) => list.map((p) => (p.id === item.id ? { ...p, failed: 'Not sent. Check your connection.' } : p)));
    }
  };

  const canSend = members.length > 0;
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    // Inside the send press or Enter, before any await, so iPhone Safari lets the replies play (plan #3036).
    unlockSpeechOutput();
    const text = draft.trim();
    if (!text || !canSend) return;
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

  const retryReply = async (options: { stalled?: boolean } = {}) => {
    const tryAgain = act.current.retryReply;
    if (!tryAgain) return;
    setReplyFailed(null);
    setRetryError(null);
    atFoot.current = true;
    // Held from the press, so the net does not ask again before Realtime says the burst has the chat.
    setLease(new Date(Date.now() + 15_000).toISOString());
    const outcome = await tryAgain(chatId, options).catch(() => ({ error: 'Not sent. Check your connection.' }));
    if (outcome.error) {
      setLease(null);
      setRetryError(outcome.error);
    }
  };

  // The safety net (plan #2988.3): a text of yours left a minute with no
  // burst holding the chat and no bot typing asks the group again, once per
  // text; the server starts nothing when a burst already ended quietly after
  // it. A failure then shows Try again.
  const owed =
    live && canSend && !leaseHeld && typingMembers.length === 0 && pending.length === 0 && !replyFailed && !retryError
      ? owedGroupReply(messages)
      : null;
  const owedId = owed?.id ?? null;
  const owedAt = owed?.createdAt ?? null;
  const asked = useRef(new Set<string>());
  const askAgain = useRef(retryReply);
  useEffect(() => {
    askAgain.current = retryReply;
  });
  useEffect(() => {
    if (!owedId || !owedAt || asked.current.has(owedId)) return;
    const age = ageOf(owedAt);
    if (!(age < STALLED_LIMIT_MS)) return;
    const timer = setTimeout(() => {
      asked.current.add(owedId);
      void askAgain.current({ stalled: true });
    }, Math.max(STALLED_MS - age, 0));
    return () => clearTimeout(timer);
  }, [owedId, owedAt]);

  const blocks = threadBlocks(messages, { timeZone: timezone, now });
  // Each bot's texts that arrived while the thread was open play aloud once,
  // in order and in that bot's own voice, while the speaking switch is on
  // (plan #3006.5). Earlier messages loaded above are older than the newest
  // the page opened with, so they never play by themselves.
  // speakOnce plays each once, so a fresh list on every draw is harmless.
  const arrived = messages.flatMap((m) =>
    m.role === 'advisor' && !openingIds.has(m.id) && m.createdAt > openedThrough && m.text.trim()
      ? [{ id: m.id, text: m.text, bot: m.speakerId ?? null }]
      : [],
  );
  useSpeakArrivals(arrived, chatId);
  const empty = messages.length === 0 && pending.length === 0;
  // A failed burst is said under your last text, while nothing newer is on its way.
  const failedNote =
    typingMembers.length === 0 && !leaseHeld && pending.length === 0 && messages.at(-1)?.role === 'person' ? (retryError ?? replyFailed) : null;

  return (
    <MessagingThread
      name={title}
      // A group with no name of its own is already called by its members, so the line under says how many.
      detail={title === groupDetailOf(members) ? `Group of ${members.length}` : groupDetailOf(members)}
      avatar={<GroupMark members={members} size="sm" />}
      back={{ href: '/chat', label: 'Messages' }}
      crumbs={[{ label: 'Messages', href: '/chat' }, { label: title, href: groupHref(chatId) }]}
      actions={
        <Link href={groupSettingsHref(chatId)} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
          Settings
        </Link>
      }
      scrollRef={scroller}
      onScroll={onScroll}
      bare={bare}
      box={
        <form onSubmit={submit} className="flex items-end gap-2">
          <MessageInput
            aria-label={`Message ${title}`}
            placeholder={canSend ? 'Message the group' : 'Add a bot in Settings first'}
            value={draft}
            maxLength={MESSAGE_MAX}
            disabled={!canSend}
            onChange={(e) => setDraft(e.target.value)}
          />
          <Tooltip label="Send">
            <Button type="submit" aria-label="Send" disabled={!canSend || !draft.trim()} className="size-(--control-h) shrink-0 rounded-pill px-0 max-sm:mb-[calc((2.75rem-var(--control-h))/2)]">
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
      {/* Which bot is speaking, pinned at the top while a reply is read aloud (plan #3043). */}
      <SpeakingPill />
      {empty && (
        <div className="my-auto flex flex-col items-center gap-2 px-4 py-8 text-center">
          <GroupMark members={members} />
          <p className="mt-1 text-body font-semibold text-ink">{title}</p>
          <p className="max-w-xs text-ui text-ink-muted">
            Nothing said yet. Write below, and whoever has something to add answers. Name someone to hear from them first.
          </p>
        </div>
      )}
      {blocks.map((block) => {
        if (block.kind === 'day') return <MessageDay key={block.key}>{block.label}</MessageDay>;
        const who = block.from === 'them' ? speakerOf(block.speakerId ?? null, members, former) : null;
        return (
          <MessageGroup key={block.key} from={block.from}>
            {block.from === 'them' && <SpeakerLabel member={who} />}
            {block.messages.map((m, i) => (
              <Fragment key={m.id}>
                <VoicedBubble
                  id={m.id}
                  text={m.role === 'advisor' && m.text.trim() ? m.text : null}
                  name={who?.name ?? 'A bot'}
                  bot={block.speakerId ?? null}
                  run={block.messages}
                >
                  <MessageBubble
                    from={block.from}
                    last={i === block.messages.length - 1 && !m.charts?.length}
                    arriving={m.role === 'advisor' && !openingIds.has(m.id)}
                  >
                    {m.text}
                  </MessageBubble>
                </VoicedBubble>
                {reactions[m.id]?.length ? <Reactions list={reactions[m.id]} members={[...members, ...former]} from={block.from} /> : null}
                {/* A chart the bot drew with this text (plan #3050.2.2). */}
                <MessageCharts charts={m.charts} caption={m.text} />
                {m.receipts.map((r) => (
                  <MessageLink key={`${r.link}-${r.label}`} href={r.link}>
                    {r.label}
                  </MessageLink>
                ))}
              </Fragment>
            ))}
            {block.from === 'them' && <SpeakRun messages={block.messages} bot={block.speakerId ?? null} />}
          </MessageGroup>
        );
      })}
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
            {actions.retryReply && (
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
      {typingMembers.map((m) => (
        <div key={m.id} className="flex flex-col items-start">
          <SpeakerLabel member={m} />
          <TypingBubble name={m.name} />
        </div>
      ))}
    </MessagingThread>
  );
}

/** Whose run of messages it is: a dot in the bot's colour and its first name. */
function SpeakerLabel({ member }: { member: GroupMember | null }) {
  return (
    <p className="mb-0.5 flex items-center gap-1.5 px-1 text-small text-ink-muted">
      <span aria-hidden className="size-2 rounded-pill" style={{ backgroundColor: member?.colour ?? 'var(--color-ink-muted)' }} />
      {member ? firstName(member.name) : 'A bot you deleted'}
    </p>
  );
}
