'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/auth/client';
import { RUN_ACTIVITY_COLUMNS, runActivityFrom, type RunActivity } from '@/lib/core/run-activities';

/** How many lines are read back for a handful of runs: enough to find each one's newest. */
const READ_BACK = 200;

/**
 * The newest line of each run, kept current while the runs go (the runner
 * card's slots, plan #1821 follow-up).
 *
 * One Realtime channel for all of them, on inserts into core.run_activities
 * for these run ids, subscribed before the read so no line falls between the
 * two, the way `LiveRunLines` does for one run. Realtime reads each event
 * through the viewer's RLS, so only the runs' owner hears anything.
 */
export function useNewestRunLines(runIds: readonly string[]): ReadonlyMap<string, RunActivity> {
  const [newest, setNewest] = useState<ReadonlyMap<string, RunActivity>>(() => new Map());
  // One string, so the effect resubscribes when the set changes and not on every render.
  const key = [...runIds].sort().join(',');

  useEffect(() => {
    const ids = key ? key.split(',') : [];
    if (ids.length === 0) return;
    const supabase = createClient();
    let gone = false;

    const keep = (lines: readonly RunActivity[]) =>
      setNewest((held) => {
        const next = new Map(held);
        for (const line of lines) {
          const had = next.get(line.run_id);
          if (!had || Date.parse(line.created_at) >= Date.parse(had.created_at)) {
            next.set(line.run_id, line);
          }
        }
        return next;
      });

    const read = async () => {
      const { data, error } = await supabase
        .schema('core')
        .from('run_activities')
        .select(RUN_ACTIVITY_COLUMNS)
        .in('run_id', ids)
        .order('created_at', { ascending: false })
        .limit(READ_BACK);
      if (gone || error) return;
      keep(
        (data ?? [])
          .map((row) => runActivityFrom(row as Record<string, unknown>))
          .filter((line): line is RunActivity => line !== null)
          .reverse(),
      );
    };

    const channel = supabase
      .channel(`runner-lines:${Math.random().toString(36).slice(2)}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'core',
          table: 'run_activities',
          filter: `run_id=in.(${ids.join(',')})`,
        },
        (payload) => {
          const line = runActivityFrom(payload.new as Record<string, unknown>);
          if (line) keep([line]);
        },
      )
      .subscribe((status) => {
        if (!gone && status === 'SUBSCRIBED') void read();
      });

    return () => {
      gone = true;
      void supabase.removeChannel(channel);
    };
  }, [key]);

  return newest;
}
