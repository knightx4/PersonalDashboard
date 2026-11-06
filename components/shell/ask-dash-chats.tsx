'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ModuleMark } from '@/components/ui/module-mark';
import { Popover } from '@/components/ui/popover';
import { PersonMark } from '@/components/patterns/messaging';
import type { ChangePresses } from '@/components/talk/dash-changes';
import { GroupMark } from '@/app/chat/group-parts';
import { ThreadView, type ThreadActions } from '@/app/chat/people/[key]/thread-view';
import { GroupThreadView, type GroupThreadActions } from '@/app/chat/groups/[id]/group-thread-view';
import { createClient } from '@/lib/auth/client';
import { cn } from '@/lib/cn';
import { personInitials } from '@/lib/you/chat-threads-model';
import {
  entriesOf,
  entryName,
  pickId,
  pickOf,
  type PanePick,
  type PaneThread,
  type PaneThreads,
  type ThreadEntry,
} from '@/lib/you/pane-threads-model';

/**
 * The Ask Dash pane's chats (plan #2981): a row of round marks above the
 * thread, Dash first and fixed at the front, then every chat on the Messages
 * tab, groups included, newest message first, each with a dot while it is
 * unread. Pressing one opens that same live thread in the pane, in place.
 *
 * The row scrolls sideways under a finger, a trackpad or a mouse wheel, and
 * fades at an edge with more beyond it. A mark's name shows under the row on
 * hover, on focus and on a long press.
 */

/** Where the pane reads its chats, and the presses an open one makes. */
export type PaneChats = {
  list: () => Promise<PaneThreads>;
  open: (pick: PanePick) => Promise<PaneThread>;
  /**
   * The open thread's presses, as its page on the Messages tab has them. The
   * gallery leaves them out, and then nothing listens to a database.
   */
  live?: { thread: ThreadActions; group: GroupThreadActions; presses: ChangePresses };
};

const SETTLE_MS = 400;

/** The chats for the row, read again whenever a chat or a message changes. */
export function useChatEntries(chats: PaneChats | undefined): { entries: ThreadEntry[]; error: string | null } {
  const [found, setFound] = useState<PaneThreads | null>(null);
  const live = Boolean(chats?.live);
  const read = useCallback(() => {
    if (!chats) return;
    void chats
      .list()
      .catch((): PaneThreads => ({ error: 'Your chats could not be read.' }))
      .then(setFound);
  }, [chats]);
  useEffect(() => {
    read();
  }, [read]);
  useEffect(() => {
    if (!live) return;
    const supabase = createClient();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        read();
      }, SETTLE_MS);
    };
    const channel = supabase
      .channel(`ask-dash-chats:${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'you', table: 'advisor_chats' }, refresh)
      .on('postgres_changes', { event: 'INSERT', schema: 'you', table: 'advisor_messages' }, refresh)
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [live, read]);
  if (!found) return { entries: [], error: null };
  if ('error' in found) return { entries: [], error: found.error };
  return { entries: entriesOf(found.rows, found.groups), error: null };
}

/** How long a finger is held on a mark before its name shows. */
const LONG_PRESS_MS = 450;
/** How long a name shown by a long press stays. */
const PEEK_MS = 1600;

type Peek = { name: string; left: number };

export function ChatRow({
  entries,
  selected,
  onPick,
}: {
  entries: readonly ThreadEntry[];
  /** The open pick's id (pickId). */
  selected: string;
  onPick: (pick: PanePick) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: false, end: false });
  const [peek, setPeek] = useState<Peek | null>(null);
  const held = useRef<{ timer: ReturnType<typeof setTimeout> | null; shown: boolean }>({ timer: null, shown: false });

  const measure = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const start = el.scrollLeft > 1;
    const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setEdges((had) => (had.start === start && had.end === end ? had : { start, end }));
  }, []);

  useLayoutEffect(() => {
    measure();
    const el = scroller.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure, entries.length]);

  // A mouse wheel turns up and down; over the row it moves the row sideways.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
      if (el.scrollWidth <= el.clientWidth) return;
      event.preventDefault();
      el.scrollLeft += event.deltaY;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  function show(name: string, button: HTMLElement) {
    const row = scroller.current?.parentElement;
    if (!row) return;
    const a = button.getBoundingClientRect();
    const b = row.getBoundingClientRect();
    setPeek({ name, left: a.left - b.left + a.width / 2 });
  }

  function hold(name: string, button: HTMLElement) {
    held.current.shown = false;
    if (held.current.timer) clearTimeout(held.current.timer);
    held.current.timer = setTimeout(() => {
      held.current.shown = true;
      show(name, button);
      setTimeout(() => setPeek((p) => (p?.name === name ? null : p)), PEEK_MS);
    }, LONG_PRESS_MS);
  }

  function letGo() {
    if (held.current.timer) clearTimeout(held.current.timer);
    held.current.timer = null;
  }

  const marks: { id: string; pick: PanePick; name: string; unread: boolean; mark: React.ReactNode }[] = [
    {
      id: 'dash',
      pick: { kind: 'dash' },
      name: 'Dash',
      unread: false,
      // Round, as every other mark in the row is, so the lit ring fits it.
      mark: (
        <span className="flex size-11 items-center justify-center overflow-hidden rounded-full [&>*]:scale-125">
          <ModuleMark module="dash" size="lg" />
        </span>
      ),
    },
    ...entries.map((entry) => {
      const pick = pickOf(entry);
      return {
        id: pickId(pick),
        pick,
        name: entryName(entry),
        unread: entry.row.unread,
        mark:
          entry.kind === 'person' ? (
            <PersonMark initials={personInitials(entry.row.name)} colour={entry.row.colour} photo={entry.row.photo} />
          ) : (
            <GroupMark members={entry.row.members} />
          ),
      };
    }),
  ];

  return (
    <div className="relative shrink-0 border-b border-border">
      <div
        ref={scroller}
        role="toolbar"
        aria-label="Chats"
        onScroll={() => {
          measure();
          setPeek(null);
        }}
        className={cn(
          'flex gap-2.5 overflow-x-auto px-4 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
          edges.start && edges.end
            ? '[mask-image:linear-gradient(to_right,transparent,#000_2rem,#000_calc(100%-2rem),transparent)]'
            : edges.end
              ? '[mask-image:linear-gradient(to_right,#000_calc(100%-2rem),transparent)]'
              : edges.start && '[mask-image:linear-gradient(to_right,transparent,#000_2rem)]',
        )}
      >
        {marks.map((m) => {
          const on = m.id === selected;
          return (
            <button
              key={m.id}
              type="button"
              aria-label={m.unread ? `${m.name}, unread` : m.name}
              aria-pressed={on}
              onClick={() => {
                // A long press showed the name; letting go does not also open the chat.
                if (held.current.shown) {
                  held.current.shown = false;
                  return;
                }
                onPick(m.pick);
              }}
              onPointerEnter={(e) => {
                if (e.pointerType === 'mouse') show(m.name, e.currentTarget);
              }}
              onPointerLeave={(e) => {
                if (e.pointerType === 'mouse') setPeek(null);
              }}
              onPointerDown={(e) => {
                if (e.pointerType !== 'mouse') hold(m.name, e.currentTarget);
              }}
              onPointerUp={letGo}
              onPointerCancel={letGo}
              onContextMenu={(e) => e.preventDefault()}
              onFocus={(e) => {
                if (e.currentTarget.matches(':focus-visible')) show(m.name, e.currentTarget);
              }}
              onBlur={() => setPeek(null)}
              className={cn(
                'press relative shrink-0 rounded-full transition-shadow duration-quick select-none [-webkit-touch-callout:none]',
                on ? 'ring-2 ring-accent ring-offset-2 ring-offset-raised' : 'hover:ring-2 hover:ring-border hover:ring-offset-2 hover:ring-offset-raised',
              )}
            >
              {m.mark}
              {m.unread && (
                <span aria-hidden data-chat-unread className="absolute -top-0.5 -right-0.5 size-3 rounded-pill bg-accent ring-2 ring-raised" />
              )}
            </button>
          );
        })}
      </div>
      {peek && (
        // The tooltip's own surface, hung from the mark rather than from the
        // row, which clips anything inside it as it scrolls.
        <Popover
          role="status"
          anchor="trigger-below"
          style={{ left: peek.left }}
          className="pointer-events-none mt-0 w-max max-w-64 -translate-x-1/2 truncate px-3 py-2 text-small text-ink"
        >
          {peek.name}
        </Popover>
      )}
    </div>
  );
}

/** One chat open in the pane: read once, then live as on the Messages tab. */
export function PaneChat({
  pick,
  chats,
  draft,
  onDraft,
}: {
  pick: Exclude<PanePick, { kind: 'dash' }>;
  chats: PaneChats;
  /** The words left in this chat's box when it was last open. */
  draft: string;
  onDraft: (text: string) => void;
}) {
  const [found, setFound] = useState<PaneThread | null>(null);
  useEffect(() => {
    let live = true;
    chats
      .open(pick)
      .catch((): PaneThread => ({ kind: 'error', error: 'That chat could not be read. Try again.' }))
      .then((thread) => {
        if (live) setFound(thread);
      });
    return () => {
      live = false;
    };
    // Once per chat: the pane draws this afresh for each pick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!found) {
    return (
      <p className="px-4 py-3 text-ui text-ink-muted" aria-live="polite">
        Opening the chat…
      </p>
    );
  }
  if (found.kind === 'error') return <p className="px-4 py-3 text-ui text-danger">{found.error}</p>;
  const live = chats.live;
  if (found.kind === 'group') {
    return (
      <GroupThreadView
        chatId={found.chatId}
        title={found.title}
        members={found.members}
        former={found.former}
        page={found.page}
        timezone={found.timezone}
        now={found.now}
        actions={live?.group}
        live={Boolean(live)}
        bare
        initialDraft={draft}
        onDraftChange={onDraft}
      />
    );
  }
  return (
    <ThreadView
      person={found.person}
      chatId={found.person.chatId}
      page={found.page}
      typingUntil={found.person.typingUntil}
      timezone={found.timezone}
      now={found.now}
      actions={live?.thread}
      live={Boolean(live)}
      changes={found.changes}
      builds={found.builds}
      presses={live?.presses}
      today={found.today}
      bare
      initialDraft={draft}
      onDraftChange={onDraft}
    />
  );
}
