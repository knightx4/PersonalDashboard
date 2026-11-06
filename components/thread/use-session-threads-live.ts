'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/auth/client';
import { listWithHeard } from '@/lib/core/session-thread-live';
import { stateOf, type SessionThread, type SessionThreadState } from '@/lib/core/session-threads-model';

type Heard = { state?: SessionThreadState; at: string };

/**
 * The Dash tab's list of session threads, kept current over Realtime (plan
 * #2789.12). One channel for the list: updates to the person's
 * core.session_threads rows (a state changing) and inserts into
 * core.session_messages (something said). No filter is needed, since
 * Realtime reads each event through the viewer's RLS and hears only their
 * own rows. A thread that moves goes to the top with its new state and is
 * marked `moved` until it is opened.
 *
 * `open` is the thread open beside the list, which is never marked.
 */
export function useSessionThreadsLive(
  threads: readonly SessionThread[],
  open: string | null,
  enabled = true,
): SessionThread[] {
  const [heard, setHeard] = useState<ReadonlyMap<string, Heard>>(() => new Map());
  const [seen, setSeen] = useState<ReadonlyMap<string, string>>(() => new Map());
  const following = enabled && threads.length > 0;

  useEffect(() => {
    if (!following) return;
    const supabase = createClient();
    let gone = false;
    const hear = (id: unknown, at: unknown, state?: unknown) => {
      if (gone || typeof id !== 'string' || typeof at !== 'string') return;
      setHeard((was) => {
        const held = was.get(id);
        const next = new Map(was);
        const newer = !held || Date.parse(at) >= Date.parse(held.at);
        next.set(id, {
          state: state === undefined ? held?.state : newer ? stateOf(state) : held?.state,
          at: newer ? at : held.at,
        });
        return next;
      });
    };
    const channel = supabase
      .channel(`session-threads:${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'core', table: 'session_threads' }, (p) => {
        const row = p.new as { id?: unknown; updated_at?: unknown; state?: unknown };
        hear(row.id, row.updated_at, row.state);
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'core', table: 'session_messages' }, (p) => {
        const row = p.new as { thread_id?: unknown; created_at?: unknown };
        hear(row.thread_id, row.created_at);
      })
      .subscribe();
    return () => {
      gone = true;
      void supabase.removeChannel(channel);
    };
  }, [following]);

  // The open thread counts as seen up to the newest thing heard on it.
  const openAt = open ? heard.get(open)?.at : undefined;
  if (open && openAt && seen.get(open) !== openAt) setSeen(new Map(seen).set(open, openAt));

  return useMemo(() => listWithHeard(threads, heard, open, seen), [threads, heard, open, seen]);
}
