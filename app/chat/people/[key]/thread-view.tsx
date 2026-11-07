'use client';

import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp } from 'lucide-react';
import { useRouter } from 'next/navigation';
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
import { MessageInput } from '@/components/patterns/message-input';
import { AddFile, FileChips, type AddFileHandle } from '@/components/attachments/add-file';
import { AskTurnFiles } from '@/components/attachments/ask-turn-files';
import { FieldError } from '@/components/ui/field';
import { filesOnlyText, type UploadedAttachment } from '@/lib/attachments/rules';
import { Tooltip } from '@/components/ui/tooltip';
import { createClient } from '@/lib/auth/client';
import { cn } from '@/lib/cn';
import { EASE, MOTION_MS } from '@/lib/motion';
import { MESSAGE_MAX } from '@/lib/you/council-model';
import {
  bubbleText,
  isTyping,
  mergeMessages,
  needsBotFiles,
  personInitials,
  receiptOf,
  replyFailedOf,
  threadBlocks,
  threadDetail,
  threadMessageOf,
  type PersonRow,
  type ThreadFile,
  type ThreadMessage,
  type ThreadPage,
} from '@/lib/you/chat-threads-model';
import { editHref } from '@/lib/you/people-cards-model';
import { placeAfterReplies, withItem } from '@/lib/you/thread-cards';
import { owedReply, STALLED_LIMIT_MS, STALLED_MS } from '@/lib/you/reply-turn';
import { DashChanges, type ChangePresses } from '@/components/talk/dash-changes';
import { LiveWorking } from '@/components/talk/live-card';
import { BubbleCharts } from '@/components/talk/reply-chart';
import { AttachedCards } from '@/components/talk/attached-cards';
import { SpeakBubble, SpeakingPill, SpeakNote, SpeakPress, SpeakSwitch, useSpeakArrivals, useSpeaking } from '@/components/talk/speak-reply';
import { unlockSpeechOutput } from '@/lib/talk/speech/output';
import type { DashChange } from '@/lib/talk/changes';
import { followedRuns, workingCard, type BuildRun } from '@/lib/you/live-cards';

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
 * - While they are still writing the reply and have already done something
 *   for it, a small live card at the foot says what (plan #2854.3), read
 *   every few seconds until the reply comes in and the change card takes
 *   over. A build you confirmed here says where it stands on its card, heard
 *   over Realtime on its run and its session's reports until it settles.
 * - Pictures and PDFs go with a message (plan #2974): the + in the box, a
 *   paste of a screenshot or a copied file, or a drop on the box. Each goes
 *   up to your folder of the attachments bucket as it is added and shows as
 *   a chip until sent; in the thread a picture is a thumbnail and a PDF its
 *   name, each opening the file. The mentor reads them with the message.
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
  /** Where the thread's confirmed builds stand, by run id, or null when they could not be read (plan #2854.3). */
  builds?: (runIds: string[]) => Promise<Record<string, BuildRun> | null>;
  /** The files a bot's code made for one message (plan #3050.3.1), or null when they could not be read. */
  files?: (messageId: string) => Promise<ThreadFile[] | null>;
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

type Pending = { id: string; text: string; at: string; failed: string | null; files?: UploadedAttachment[] };

/** A message as it stands the moment you press send. */
function newPending(text: string, files: UploadedAttachment[] = []): Pending {
  const at = new Date();
  return {
    id: `pending-${at.getTime()}-${Math.random().toString(36).slice(2, 6)}`,
    text,
    at: at.toISOString(),
    failed: null,
    ...(files.length > 0 ? { files } : {}),
  };
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
/** No builds, as one object, for the same reason. */
const NO_BUILDS: Record<string, BuildRun> = {};

/** While a reply is being written, how often what they have done for it is read. */
const WORKING_POLL_MS = 2_500;
/** Several reports close together read the builds once. */
const BUILDS_SETTLE_MS = 750;

/** Calls `run` every `ms` while `ms` is set; the newest `run` is the one called. */
function useEvery(ms: number | null, run: () => void) {
  const latest = useRef(run);
  useEffect(() => {
    latest.current = run;
  });
  useEffect(() => {
    if (ms === null) return;
    const timer = setInterval(() => latest.current(), ms);
    return () => clearInterval(timer);
  }, [ms]);
}

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
  builds: initialBuilds = NO_BUILDS,
  today,
  nextText = null,
  draftFiles,
  draftFileErrors,
  bare = false,
  initialDraft = '',
  onDraftChange,
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
  /** Where the confirmed builds among those changes stand, by run id (loadBuildRuns). */
  builds?: Record<string, BuildRun>;
  /** YYYY-MM-DD in the person's zone, so a due date this year leaves the year off. */
  today?: string;
  /** "Next text Monday, if there is something new", for someone with a reach-out rule (plan #2931.3). */
  nextText?: string | null;
  /** Files already added to the box, and why one was refused, for the gallery. */
  draftFiles?: UploadedAttachment[];
  draftFileErrors?: string[];
  /** Drawn in the Ask Dash pane (plan #2981), which names the thread in its own header. */
  bare?: boolean;
  /** What the box opens with, unsent: the pane keeps each thread's words while another is open. */
  initialDraft?: string;
  /** Told each change to the box's words, so the pane can keep them. */
  onDraftChange?: (text: string) => void;
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
  // Why the reply failed, as Realtime last said or as the server drew it (plan #2854.4).
  const [heardFailed, setReplyFailed] = useState<string | null | undefined>(undefined);
  // Typing as Realtime last said, or as the server drew it before Realtime has spoken.
  const [heardTyping, setTypingUntil] = useState<string | null | undefined>(undefined);
  const typingUntil = heardTyping === undefined ? initialTyping : heardTyping;
  // A fresh page from the server (on return to the tab, or after Realtime
  // reconnects) says where typing and the reply stand; what was heard before it gives way.
  const [drawnReply, setDrawnReply] = useState({ typing: initialTyping, failed: person.replyFailed ?? null });
  if (drawnReply.typing !== initialTyping || drawnReply.failed !== (person.replyFailed ?? null)) {
    setDrawnReply({ typing: initialTyping, failed: person.replyFailed ?? null });
    setTypingUntil(undefined);
    setReplyFailed(undefined);
  }
  const [pending, setPending] = useState<Pending[]>(initialPending);
  const replyFailed = heardFailed === undefined ? (person.replyFailed ?? null) : heardFailed;
  const [retryError, setRetryError] = useState<string | null>(null);
  // The changes as the server drew them, then as a press or a re-read left them.
  const [changes, setChanges] = useState<DashChange[]>(initialChanges);
  const [drawnChanges, setDrawnChanges] = useState(initialChanges);
  if (initialChanges !== drawnChanges) {
    setDrawnChanges(initialChanges);
    setChanges(initialChanges);
  }
  // The builds as the server drew them, then as a refresh left them.
  const [builds, setBuilds] = useState<Record<string, BuildRun>>(initialBuilds);
  const [drawnBuilds, setDrawnBuilds] = useState(initialBuilds);
  if (initialBuilds !== drawnBuilds) {
    setDrawnBuilds(initialBuilds);
    setBuilds(initialBuilds);
  }
  const onChanged = useCallback((change: DashChange) => setChanges((list) => withItem(list, change)), []);
  const [draft, setDraftText] = useState(initialDraft);
  const setDraft = (text: string) => {
    setDraftText(text);
    onDraftChange?.(text);
  };
  // The files added to the box and not yet sent (plan #2974).
  const [files, setFiles] = useState<UploadedAttachment[]>(draftFiles ?? []);
  const [uploading, setUploading] = useState(false);
  const [fileErrors, setFileErrors] = useState<string[]>(draftFileErrors ?? []);
  const adder = useRef<AddFileHandle>(null);
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

  // Realtime: the thread's messages and its typing. Realtime does not replay
  // what it missed while the phone slept or the socket dropped, so the page is
  // read again whenever the channel joins after the first time, or the tab
  // comes back; without it a reply written meanwhile stayed hidden until the
  // next send redrew the page (plan #2988).
  const router = useRouter();
  const drawnWithChat = useRef(initialChatId !== null);
  // The bot messages whose files were asked for, by id and count, so a receipt's update does not ask again.
  const askedFiles = useRef(new Set<string>());
  useEffect(() => {
    if (!live || !chatId) return;
    const supabase = createClient();
    let joined = drawnWithChat.current ? 0 : 1;
    const channel = supabase
      .channel(`chat-thread:${chatId}:${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'you', table: 'advisor_messages', filter: `chat_id=eq.${chatId}` }, (event) => {
        const row = threadMessageOf((event.new ?? {}) as Record<string, unknown>);
        if (!row) return;
        setMessages((list) => mergeMessages(list, [row]));
        if (row.role === 'advisor' && !row.readAt && shown()) void act.current.read(chatId, person.id);
        // The bot's code made files for this text (plan #3050.3.1): a Realtime row never carries them.
        const asking = `${row.id}:${row.fileCount ?? 0}`;
        if (needsBotFiles(row) && !askedFiles.current.has(asking)) {
          askedFiles.current.add(asking);
          void act.current.files?.(row.id).then((files) => {
            if (!files || files.length === 0) return;
            setMessages((list) => list.map((m) => (m.id === row.id ? { ...m, files } : m)));
          });
        }
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
  }, [live, chatId, person.id, router]);

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
  }, [messages, pending, typingUntil, changes]);

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
        body: JSON.stringify({ advisorId: person.id, text: item.text, files: item.files ?? [] }),
      });
      const body = (await res.json().catch(() => null)) as {
        chatId?: string;
        messageId?: string;
        files?: ThreadFile[];
        error?: string;
      } | null;
      if (!res.ok || !body?.messageId || !body.chatId) {
        setPending((list) => list.map((p) => (p.id === item.id ? { ...p, failed: body?.error ?? 'Not sent.' } : p)));
        return;
      }
      const sentFiles = Array.isArray(body.files) ? body.files : [];
      const sent: ThreadMessage = {
        id: body.messageId,
        chatId: body.chatId,
        role: 'person',
        kind: 'reply',
        // A message of files alone is saved as their names, which the bubble leaves out.
        text: item.text || filesOnlyText(sentFiles.map((f) => f.name)),
        receipts: [],
        createdAt: item.at,
        deliveredAt: null,
        readAt: null,
        ...(sentFiles.length > 0 ? { files: sentFiles } : {}),
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
    // Inside the send press or Enter, before any await, so iPhone Safari lets the replies play (plan #3036).
    unlockSpeechOutput();
    const text = draft.trim();
    if ((!text && files.length === 0) || !person.canTalk || uploading) return;
    const item = newPending(text, files);
    setPending((list) => [...list, item]);
    setDraft('');
    setFiles([]);
    setFileErrors([]);
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

  // While the reply is being written, what they have done for it is read every
  // few seconds, so the live card shows it before the reply comes in.
  const typingNow = isTyping(typingUntil, now);
  const awaitingReply = typingNow && pending.length === 0 && messages.at(-1)?.role === 'person';
  useEvery(live && chatId && awaitingReply ? WORKING_POLL_MS : null, () => {
    if (chatId) void act.current.changes?.(chatId).then((next) => next && setChanges(next));
  });

  // The safety net (plan #2988): a text of theirs left with no reply and
  // nothing writing one is answered once it has waited a minute, as Try
  // again would. Each text is asked for once; a failure then shows Try again.
  const owed =
    live && chatId && person.canTalk && !typingNow && pending.length === 0 && !replyFailed && !retryError ? owedReply(messages) : null;
  const owedId = owed?.id ?? null;
  const owedAt = owed?.createdAt ?? null;
  const asked = useRef(new Set<string>());
  const askAgain = useRef(retryReply);
  useEffect(() => {
    askAgain.current = retryReply;
  });
  useEffect(() => {
    if (!owedId || !owedAt || asked.current.has(owedId)) return;
    const age = Date.now() - Date.parse(owedAt);
    if (!(age < STALLED_LIMIT_MS)) return;
    const timer = setTimeout(() => {
      asked.current.add(owedId);
      void askAgain.current();
    }, Math.max(STALLED_MS - age, 0));
    return () => clearTimeout(timer);
  }, [owedId, owedAt]);

  // The builds still going are heard over Realtime: their run and their
  // session's reports. One newly confirmed is read straight away.
  const goingKey = followedRuns(changes, builds).join(',');
  // What has been read so far, for the effect below, which runs once per set of builds going.
  const heardBuilds = useRef(builds);
  useEffect(() => {
    heardBuilds.current = builds;
  }, [builds]);
  useEffect(() => {
    if (!live || !goingKey) return;
    const ids = goingKey.split(',');
    const read = () => void act.current.builds?.(ids).then((next) => next && setBuilds((had) => ({ ...had, ...next })));
    if (ids.some((id) => !(id in heardBuilds.current))) read();
    const supabase = createClient();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        read();
      }, BUILDS_SETTLE_MS);
    };
    const filter = `in.(${ids.join(',')})`;
    const channel = supabase
      .channel(`chat-builds:${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'plan_runs', filter: `id=${filter}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'core', table: 'session_progress', filter: `plan_run_id=${filter}` }, refresh)
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [live, goingKey]);

  const typing = typingNow;
  const blocks = threadBlocks(messages, { timeZone: timezone, now });
  // Their messages that arrived while the thread was open play aloud once,
  // in order, while the speaking switch is on (plan #3006.1).
  const arrived = useMemo(
    () =>
      messages.flatMap((m) => {
        const words = m.role === 'advisor' && !openingIds.has(m.id) && !olderIds.has(m.id) ? bubbleText(m) : null;
        return words ? [{ id: m.id, text: words, bot: person.id }] : [];
      }),
    [messages, openingIds, olderIds, person.id],
  );
  useSpeakArrivals(arrived, person.key);
  const receipt = pending.length === 0 ? receiptOf(messages) : null;
  // What they have done for a reply still coming is the live card's, at the foot, until the reply settles it.
  const working = workingCard(messages, changes, awaitingReply, today);
  const cards = placeAfterReplies(
    messages,
    working ? changes.filter((change) => change.advisorMessageId !== working.messageId) : changes,
    (change) => change.advisorMessageId,
  );
  const empty = messages.length === 0 && pending.length === 0;
  // A failed reply is said under your last message, while nothing newer is on its way.
  const failedNote =
    !typing && pending.length === 0 && messages.at(-1)?.role === 'person' ? (retryError ?? replyFailed) : null;

  return (
    <MessagingThread
      name={person.name}
      detail={nextText && person.canTalk ? nextText : threadDetail(person)}
      avatar={<PersonMark initials={personInitials(person.name)} colour={person.colour} photo={person.photo} size="sm" />}
      back={{ href: '/chat', label: 'Messages' }}
      crumbs={[{ label: 'Messages', href: '/chat' }, { label: person.name, href: `/chat/people/${person.key}` }]}
      actions={
        <>
          {/* Their new messages read aloud while on (plan #3006.1). */}
          <SpeakSwitch look="icon" />
          <Link href={editHref(person.key)} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
            Edit
          </Link>
        </>
      }
      scrollRef={scroller}
      onScroll={onScroll}
      bare={bare}
      box={
        <form
          onSubmit={submit}
          className="flex flex-col gap-1.5"
          // A file dropped on the box is added as a pasted one is.
          onDragOver={(e) => {
            if (person.canTalk && e.dataTransfer.types.includes('Files')) e.preventDefault();
          }}
          onDrop={(e) => {
            if (adder.current?.paste(e.dataTransfer)) e.preventDefault();
          }}
        >
          <FileChips value={files} onChange={setFiles} />
          {fileErrors.length > 0 && <FieldError>{fileErrors.join(' ')}</FieldError>}
          <div className="flex items-end gap-2">
            <div className="shrink-0 max-sm:mb-[calc((2.75rem-var(--control-h))/2)]">
              <AddFile
                ref={adder}
                value={files}
                onChange={setFiles}
                disabled={!person.canTalk}
                onUploadingChange={setUploading}
                onErrors={setFileErrors}
                plus
                showList={false}
              />
            </div>
            <MessageInput
              aria-label={`Message ${person.name}`}
              placeholder={person.canTalk ? 'Message' : 'Not ready to talk yet'}
              value={draft}
              maxLength={MESSAGE_MAX}
              disabled={!person.canTalk}
              onChange={(e) => setDraft(e.target.value)}
              // A screenshot or a copied file goes in as a file.
              onPaste={(e) => {
                if (adder.current?.paste(e.clipboardData)) e.preventDefault();
              }}
            />
            <Tooltip label="Send">
              <Button
                type="submit"
                aria-label="Send"
                disabled={!person.canTalk || uploading || (!draft.trim() && files.length === 0)}
                className="size-(--control-h) shrink-0 rounded-pill px-0 max-sm:mb-[calc((2.75rem-var(--control-h))/2)]"
              >
                <ArrowUp className="size-4" strokeWidth={1.75} aria-hidden />
              </Button>
            </Tooltip>
          </div>
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
      {/* Who is speaking, pinned at the top while a reply is read aloud (plan #3043). */}
      <SpeakingPill />
      {empty && <EmptyThread person={person} />}
      {blocks.map((block) =>
        block.kind === 'day' ? (
          <MessageDay key={block.key}>{block.label}</MessageDay>
        ) : (
          <MessageGroup key={block.key} from={block.from}>
            {block.messages.map((m, i) => {
              const words = bubbleText(m);
              const lastOfRun = i === block.messages.length - 1 && !cards.has(m.id);
              return (
                <Fragment key={m.id}>
                  {/* A card under a bubble carries on the run, so the bubble keeps its corner tucked. */}
                  {words !== null && (
                    <VoicedBubble id={m.id} text={m.role === 'advisor' ? words : null} name={person.name} bot={person.id} run={block.messages}>
                      <MessageBubble from={block.from} last={lastOfRun && !m.files?.length && !m.charts?.length && !m.attached?.length} arriving={arrives(m)}>
                        {words}
                      </MessageBubble>
                    </VoicedBubble>
                  )}
                  {m.files && m.files.length > 0 && (
                    <AskTurnFiles
                      files={m.files}
                      large
                      align={block.from === 'you' ? 'end' : 'start'}
                      label={block.from === 'you' ? 'Sent with this message' : `Made by ${person.name} for this reply`}
                    />
                  )}
                  {/* What the bot drew with show_chart (plan #3050.2.2), kept on the row, so a reopened thread draws it again. */}
                  <BubbleCharts charts={m.charts} />
                  {/* A saved page or file the bot attached by reference (plan #3050.4), as a card that opens it. */}
                  {m.attached && m.attached.length > 0 && (
                    <MessageCard>
                      <AttachedCards cards={m.attached} label={`Sent by ${person.name} with this reply`} />
                    </MessageCard>
                  )}
                  {m.receipts.map((r) => (
                    <MessageLink key={`${r.link}-${r.label}`} href={r.link}>
                      {r.label}
                    </MessageLink>
                  ))}
                  {cards.has(m.id) && (
                    <MessageCard>
                      <DashChanges
                        changes={cards.get(m.id) ?? []}
                        presses={presses}
                        onChanged={onChanged}
                        today={today}
                        by={person.name}
                        builds={builds}
                        inThread
                      />
                    </MessageCard>
                  )}
                </Fragment>
              );
            })}
            {receipt && block.messages.at(-1)?.id === receipt.id && <MessageNote>{receipt.label}</MessageNote>}
            {block.from === 'them' && <SpeakRun messages={block.messages} bot={person.id} />}
          </MessageGroup>
        ),
      )}
      {pending.length > 0 && (
        <MessageGroup from="you">
          {pending.map((p, i) => (
            <div key={p.id} className="flex flex-col items-end">
              <span className={cn('flex flex-col items-end gap-0.5', p.failed && 'opacity-60')}>
                {p.text && (
                  <MessageBubble from="you" last={i === pending.length - 1 && !p.files?.length}>
                    {p.text}
                  </MessageBubble>
                )}
                {p.files && p.files.length > 0 && <AskTurnFiles files={p.files} large align="end" label="Sending with this message" />}
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
      {working ? <LiveWorking card={working} name={person.name} /> : typing && <TypingBubble name={person.name} />}
    </MessagingThread>
  );
}

/**
 * Read aloud under a run of their messages (plan #3006.1): the press reads
 * the run together, and shows Stop while any of it plays, including a
 * message playing by itself as it arrived. Why it was not read is said under
 * it. The run is read in `bot`'s own voice when it has one (plan #3006.5).
 * A group's thread draws it too, under each bot's run.
 */
export function SpeakRun({ messages, bot }: { messages: readonly ThreadMessage[]; bot: string | null }) {
  const speaking = useSpeaking();
  const said = spokenOf(messages);
  const last = said.at(-1);
  if (!last) return null;
  const ids = said.map((m) => m.id);
  return (
    <div className="flex flex-col items-start">
      {/* While speaking is on, each bubble carries its own speaker instead (plan #3043). */}
      {!speaking && <SpeakPress id={last.id} text={said.map((m) => m.text).join('\n\n')} also={ids} parts={said} bot={bot} />}
      <SpeakNote ids={ids} className="px-1" />
    </div>
  );
}

/** The bubbles of a run that can be read aloud: theirs, with words. */
function spokenOf(messages: readonly ThreadMessage[]): { id: string; text: string }[] {
  return messages.flatMap((m) => {
    const words = m.role === 'advisor' ? bubbleText(m) : null;
    return words ? [{ id: m.id, text: words }] : [];
  });
}

/**
 * A bubble with its speaker beside it while speaking is on (plan #3043):
 * `text` is what is read, null for your own messages, which have none. A
 * press at rest reads it and the rest of `run` after it. A group's thread
 * draws it too, with each bot's name and voice.
 */
export function VoicedBubble({
  id,
  text,
  name,
  bot,
  run,
  children,
}: {
  id: string;
  text: string | null;
  name: string;
  bot: string | null;
  run: readonly ThreadMessage[];
  children: React.ReactNode;
}) {
  if (text === null) return children;
  const said = spokenOf(run);
  const then = said.slice(said.findIndex((m) => m.id === id) + 1);
  return (
    <div className="flex max-w-full items-end gap-1 *:min-w-0">
      {children}
      <SpeakBubble id={id} text={text} name={name} bot={bot} then={then} />
    </div>
  );
}

function EmptyThread({ person }: { person: PersonRow }) {
  return (
    <div className="my-auto flex flex-col items-center gap-2 px-4 py-8 text-center">
      <PersonMark initials={personInitials(person.name)} colour={person.colour} photo={person.photo} size="lg" />
      <p className="mt-1 text-body font-semibold text-ink">{person.name}</p>
      <p className="max-w-xs text-ui text-ink-muted">
        {person.canTalk
          ? `Nothing said yet. Write to ${person.name} below and they reply in a few seconds.`
          : `${person.name} can talk once Dash has finished reading their work.`}
      </p>
    </div>
  );
}
