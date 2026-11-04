'use client';

import { useEffect, useRef, useState } from 'react';
import Link from '@/components/ui/link';
import { useRouter } from 'next/navigation';
import { Plus, Search } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { ADD_HREF } from '@/lib/you/people-cards-model';
import { PersonMark } from '@/components/patterns/messaging';
import { Input } from '@/components/ui/field';
import { createClient } from '@/lib/auth/client';
import { cn } from '@/lib/cn';
import { useRowArrival } from './use-row-arrival';
import {
  isTyping,
  personInitials,
  previewOf,
  threadHref,
  threadTime,
  type PersonRow,
  type SearchHit,
} from '@/lib/you/chat-threads-model';

/**
 * The People list (plan #2748.6): everyone you talk to, newest thread first,
 * each with their initials in their colour, the last thing said, its time,
 * and a dot while it is unread; "typing…" in place of the last line while
 * they write. The search box above it finds words across every thread.
 *
 * Live, the list hears every change to your threads and messages over
 * Realtime and redraws from the server, so a new message, a read thread and
 * typing reach it without a reload. Typing ends on its own clock, so the
 * list also redraws when the soonest typing_until passes.
 */

const SETTLE_MS = 400;

/** Redraw from the server when a thread or a message changes. */
function useLiveThreads(live: boolean) {
  const router = useRouter();
  useEffect(() => {
    if (!live) return;
    const supabase = createClient();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        router.refresh();
      }, SETTLE_MS);
    };
    const channel = supabase
      .channel(`chat-people:${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'you', table: 'advisor_chats' }, refresh)
      .on('postgres_changes', { event: 'INSERT', schema: 'you', table: 'advisor_messages' }, refresh)
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [live, router]);
}

/** Now, moved on when the soonest typing ends so "typing…" goes without a reload. */
function useTypingClock(rows: readonly PersonRow[], start: number, live: boolean): number {
  const [now, setNow] = useState(start);
  useEffect(() => {
    if (!live) return;
    const ends = rows
      .map((r) => (r.typingUntil ? Date.parse(r.typingUntil) : NaN))
      .filter((t) => Number.isFinite(t) && t > now);
    if (ends.length === 0) return;
    const wait = Math.min(...ends) - now + 50;
    const timer = setTimeout(() => setNow(Date.now()), Math.max(wait, 50));
    return () => clearTimeout(timer);
  }, [rows, now, live]);
  return live ? Math.max(now, start) : start;
}

export function PeopleList({
  rows,
  current = null,
  currentWide = false,
  query = null,
  hits = null,
  timezone,
  now: start,
  live = true,
}: {
  rows: readonly PersonRow[];
  /** The key of the open thread, lit in the list. */
  current?: string | null;
  /** The open thread shows only from laptop width (the newest, on /chat), so a phone does not light its row. */
  currentWide?: boolean;
  /** What the search box holds. */
  query?: string | null;
  /** What the search found, in place of the rows while there is a search. */
  hits?: readonly SearchHit[] | null;
  timezone: string;
  now: number;
  /** False in the gallery, which has no database to listen to. */
  live?: boolean;
}) {
  useLiveThreads(live);
  const now = useTypingClock(rows, start, live);
  const listRef = useRef<HTMLUListElement>(null);
  useRowArrival(listRef, rows);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 px-4 pt-4 pb-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-display text-title font-semibold tracking-tight text-ink">People</h2>
          <Link href={ADD_HREF} className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), '-mr-2')}>
            <Plus className="size-4" strokeWidth={1.75} aria-hidden />
            Add
          </Link>
        </div>
        <form action="/chat" role="search" className="relative mt-3">
          <Search aria-hidden strokeWidth={1.75} className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-muted" />
          <Input
            type="search"
            name="q"
            defaultValue={query ?? ''}
            aria-label="Search messages"
            placeholder="Search messages"
            className="border-transparent bg-sunken pl-9 text-ui max-sm:min-h-11"
          />
        </form>
      </div>
      {hits ? (
        <SearchResults hits={hits} query={query ?? ''} current={current} wide={currentWide} timezone={timezone} now={now} />
      ) : (
        // One run, as the reference: the threads newest first, then those never
        // written to, whose quiet "Say hello" is never a line of theirs (sortPeople).
        <ul ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {rows.map((row) => (
            <PersonItem key={row.id} row={row} current={row.key === current} wide={currentWide} timezone={timezone} now={now} />
          ))}
        </ul>
      )}
    </div>
  );
}

function PersonItem({
  row,
  current,
  wide,
  timezone,
  now,
}: {
  row: PersonRow;
  current: boolean;
  wide: boolean;
  timezone: string;
  now: number;
}) {
  const typing = isTyping(row.typingUntil, now);
  return (
    <li data-person-row={row.id} className="relative rounded-control">
      <Link
        href={threadHref(row.key)}
        aria-current={current && !wide ? 'page' : undefined}
        className={cn(
          'grid min-h-11 grid-cols-[2.75rem_minmax(0,1fr)_auto] items-start gap-2.5 rounded-control px-2 py-2 hover:bg-sunken',
          current && (wide ? 'min-[720px]:bg-accent-tint' : 'bg-accent-tint hover:bg-accent-tint'),
        )}
      >
        <PersonMark initials={personInitials(row.name)} colour={row.colour} />
        <span className="min-w-0">
          <span className={cn('block truncate text-body text-ink', row.unread ? 'font-bold' : 'font-semibold')}>
            {row.name}
          </span>
          <span
            data-person-preview
            className={cn(
              'line-clamp-2 text-small',
              typing ? 'text-accent' : row.unread ? 'text-ink' : 'text-ink-muted',            )}
          >
            {previewOf(row, now)}
          </span>
        </span>
        <span className="flex flex-col items-end gap-1.5 pt-0.5">
          {row.last && (
            <span className="tabular text-small text-ink-muted">{threadTime(row.last.at, { timeZone: timezone, now })}</span>
          )}
          {row.unread && <span role="img" aria-label="Unread" data-person-unread className="size-2 rounded-pill bg-accent" />}
        </span>
      </Link>
    </li>
  );
}

function SearchResults({
  hits,
  query,
  current,
  wide,
  timezone,
  now,
}: {
  hits: readonly SearchHit[];
  query: string;
  /** The key of the open thread: its first result is lit, as the open row is. */
  current: string | null;
  wide: boolean;
  timezone: string;
  now: number;
}) {
  const lit = hits.find((hit) => hit.key === current)?.id ?? null;
  if (hits.length === 0) {
    return (
      <div className="px-4 py-2">
        <p className="text-ui text-ink-muted">Nothing in your threads says “{query}”.</p>
        <Link href="/chat" className="press-area mt-2 inline-block text-ui text-accent hover:underline">
          Clear the search
        </Link>
      </div>
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <p className="shrink-0 px-4 pb-1 text-small text-ink-muted">
        {hits.length} {hits.length === 1 ? 'message' : 'messages'} with “{query}” ·{' '}
        <Link href="/chat" className="press-area text-accent hover:underline">
          Clear
        </Link>
      </p>
      <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {hits.map((hit) => (
          <li key={hit.id}>
            <Link
              href={threadHref(hit.key)}
              aria-current={hit.id === lit && !wide ? 'page' : undefined}
              className={cn(
                'grid min-h-11 grid-cols-[2.75rem_minmax(0,1fr)_auto] items-start gap-2.5 rounded-control px-2 py-2 hover:bg-sunken',
                hit.id === lit && (wide ? 'min-[720px]:bg-accent-tint' : 'bg-accent-tint hover:bg-accent-tint'),
              )}
            >
              <PersonMark initials={personInitials(hit.name)} colour={hit.colour} />
              <span className="min-w-0">
                <span className="block truncate text-body font-semibold text-ink">{hit.name}</span>
                <span className="line-clamp-2 text-small text-ink-muted">
                  {hit.role === 'person' ? `You: ${hit.text}` : hit.text}
                </span>
              </span>
              <span className="tabular pt-0.5 text-small text-ink-muted">{threadTime(hit.at, { timeZone: timezone, now })}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
