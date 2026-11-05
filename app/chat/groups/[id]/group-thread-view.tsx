'use client';

import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowUp } from 'lucide-react';
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
import { createClient } from '@/lib/auth/client';
import { cn } from '@/lib/cn';
import { MESSAGE_MAX } from '@/lib/you/council-model';
import { mergeMessages, threadBlocks, threadMessageOf, type ThreadMessage } from '@/lib/you/chat-threads-model';
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

/**
 * A group chat on the Messages tab (plan #2879.1.3): the person and two to
 * eight bots. Each bot's run of messages carries its name in its colour, a
 * bot's tap back sits on the edge of the bubble it reacted to, and each bot
 * typing shows its own dots with its name. The bots' messages, reactions
 * and typing arrive over Realtime (you.advisor_messages,
 * you.advisor_message_reactions, you.advisor_chat_members.typing_until).
 * Sending goes through POST /api/chat/groups/[id]/messages; the director
 * decides who answers, so nothing claims a bot is typing until one is.
 */

export type GroupThreadActions = {
  older: (chatId: string, before: string) => Promise<{ messages: ThreadMessage[]; hasOlder: boolean; reactions: Record<string, Reacted[]> } | { error: string }>;
  read: (chatId: string) => Promise<void>;
};

const NO_ACTIONS: GroupThreadActions = {
  older: async () => ({ messages: [], hasOlder: false, reactions: {} }),
  read: async () => {},
};

type Pending = { id: string; text: string; at: string; failed: string | null };

/** A message as it stands the moment you press send. */
function newPending(text: string): Pending {
  const at = new Date();
  return { id: `pending-${at.getTime()}-${Math.random().toString(36).slice(2, 6)}`, text, at: at.toISOString(), failed: null };
}

const NEAR_FOOT_PX = 120;
const NEAR_TOP_PX = 80;

export type GroupThreadProps = {
  chatId: string;
  title: string;
  members: GroupMember[];
  former: GroupMember[];
  page: { messages: ThreadMessage[]; hasOlder: boolean; reactions: Record<string, Reacted[]> };
  timezone: string;
  now: number;
  actions?: GroupThreadActions;
  live?: boolean;
  /** For the gallery: messages still being sent. */
  pending?: Pending[];
};

export function GroupThreadView({
  chatId,
  title,
  members: firstMembers,
  former,
  page,
  timezone,
  now: start,
  actions = NO_ACTIONS,
  live = true,
  pending: initialPending = [],
}: GroupThreadProps) {
  const [heard, setHeard] = useState<ThreadMessage[]>([]);
  const messages = mergeMessages(page.messages, heard);
  const [extraReactions, setReactions] = useState<Record<string, Reacted[]>>({});
  const reactions = { ...page.reactions, ...extraReactions };
  const [typing, setTyping] = useState<Record<string, string | null>>({});
  const members = firstMembers.map((m) => (m.id in typing ? { ...m, typingUntil: typing[m.id] } : m));
  const [openingIds] = useState(() => new Set(page.messages.map((m) => m.id)));
  const [hasOlderState, setHasOlder] = useState<boolean | null>(null);
  const hasOlder = hasOlderState ?? page.hasOlder;
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending[]>(initialPending);
  const [draft, setDraft] = useState('');
  const [now, setNow] = useState(start);
  const scroller = useRef<HTMLDivElement | null>(null);
  const keepFrom = useRef<number | null>(null);
  const atFoot = useRef(true);
  const act = useRef(actions);
  useEffect(() => {
    act.current = actions;
  }, [actions]);

  useEffect(() => {
    if (!live) return;
    const supabase = createClient();
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
      .on('postgres_changes', { event: '*', schema: 'you', table: 'advisor_message_reactions' }, (event) => {
        const next = (event.new ?? {}) as Record<string, unknown>;
        if (typeof next.message_id !== 'string' || typeof next.advisor_id !== 'string' || !isReaction(next.reaction)) return;
        const messageId = next.message_id;
        const reacted: Reacted = { advisorId: next.advisor_id, reaction: next.reaction };
        setReactions((r) => ({ ...r, [messageId]: [...(r[messageId] ?? page.reactions[messageId] ?? []).filter((x) => x.advisorId !== reacted.advisorId), reacted] }));
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [live, chatId, page.reactions]);

  useEffect(() => {
    if (live) void act.current.read(chatId);
  }, [live, chatId]);

  // Each bot's dots end on their own clock.
  const soonest = members
    .map((m) => (m.typingUntil ? Date.parse(m.typingUntil) : NaN))
    .filter((t) => Number.isFinite(t) && t > now)
    .sort((a, b) => a - b)[0];
  useEffect(() => {
    if (!live || !soonest) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.max(soonest - Date.now() + 50, 50));
    return () => clearTimeout(timer);
  }, [live, soonest]);

  const typingMembers = members.filter((m) => m.typingUntil && Date.parse(m.typingUntil) > now);

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

  const blocks = threadBlocks(messages, { timeZone: timezone, now });
  const empty = messages.length === 0 && pending.length === 0;

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
            <Button type="submit" aria-label="Send" disabled={!canSend || !draft.trim()} className="size-(--control-h) rounded-pill px-0">
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
                <MessageBubble from={block.from} last={i === block.messages.length - 1} arriving={m.role === 'advisor' && !openingIds.has(m.id)}>
                  {m.text}
                </MessageBubble>
                {reactions[m.id]?.length ? <Reactions list={reactions[m.id]} members={[...members, ...former]} from={block.from} /> : null}
                {m.receipts.map((r) => (
                  <MessageLink key={`${r.link}-${r.label}`} href={r.link}>
                    {r.label}
                  </MessageLink>
                ))}
              </Fragment>
            ))}
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
