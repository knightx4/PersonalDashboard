'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/auth/client';
import type { RunnerSlot } from '@/lib/plan/overnight-slots';

/**
 * A run starting or ending moves a slot, so a change to either runs table
 * sends the read again. The overnight row is not published to Realtime; the
 * read every two minutes catches the runner being started, held or stopped.
 */
const TABLES = [
  { schema: 'public', table: 'plan_runs' },
  { schema: 'goals', table: 'runs' },
] as const;

/** A burst of changes (a session ending and the next one firing) is read once. */
const SETTLE_MS = 2_000;

/** Read again this often whatever Realtime says, for a tick that wrote nothing it hears. */
const EVERY_MS = 120_000;

/**
 * The runner's four slots for the status line, read from /api/plan/crew.
 *
 * Read once the page has drawn, then again on any change to the runs, and
 * every two minutes besides. A failed read leaves what was
 * held. Off for anyone but the owner: `enabled` is the shell's owner check,
 * so nobody else makes the request at all.
 */
export function useRunnerSlots(enabled: boolean): readonly RunnerSlot[] {
  const [slots, setSlots] = useState<readonly RunnerSlot[]>([]);

  useEffect(() => {
    if (!enabled) return;
    let gone = false;
    let timer: number | undefined;

    const read = async () => {
      try {
        const res = await fetch('/api/plan/crew', { cache: 'no-store' });
        if (!res.ok) return;
        const body = (await res.json()) as { slots?: RunnerSlot[] };
        if (!gone && Array.isArray(body.slots)) setSlots(body.slots);
      } catch {
        // Left as it was; the next change or the next interval reads again.
      }
    };
    const soon = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void read(), SETTLE_MS);
    };

    const supabase = createClient();
    let channel = supabase.channel(`runner-slots:${Math.random().toString(36).slice(2)}`);
    for (const { schema, table } of TABLES) {
      channel = channel.on('postgres_changes', { event: '*', schema, table }, soon);
    }
    channel.subscribe();

    void read();
    const every = window.setInterval(() => void read(), EVERY_MS);

    return () => {
      gone = true;
      window.clearTimeout(timer);
      window.clearInterval(every);
      void supabase.removeChannel(channel);
    };
  }, [enabled]);

  return slots;
}
