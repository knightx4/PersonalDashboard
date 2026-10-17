'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/auth/client';
import { runFollowable, runStatusGoing, runTableParts, type RunRef } from '@/lib/core/run-going';

/**
 * Whether the run a button started is still going, kept current over
 * Realtime (plan #1964.2.1).
 *
 * Starts from what the page knew (`run.going`, or going for a run just handed
 * over), then follows the run's own row: one channel on updates to that row,
 * subscribed before the read so an ending cannot fall between the two. Both
 * runs tables are in the supabase_realtime publication (0199) and Realtime
 * reads each event through the viewer's RLS, so only the run's owner hears
 * it. A read that fails leaves the page's own answer standing; the next
 * update, or the page's refresh when the run ends, corrects it.
 */
export function useRunGoing(run: RunRef | null | undefined): boolean {
  const id = run?.id ?? null;
  const table = run?.table ?? null;
  const seed = run ? run.going !== false : false;
  // Held with the run it is about, so a new run starts from its own seed.
  const [heard, setHeard] = useState<{ id: string; going: boolean } | null>(null);
  const followable = runFollowable(run);

  useEffect(() => {
    if (!followable || !id || !table) return;
    const supabase = createClient();
    const parts = runTableParts(table);
    let gone = false;
    const hear = (status: unknown) => {
      if (!gone) setHeard({ id, going: runStatusGoing(status) });
    };

    const read = async () => {
      const { data, error } = await supabase
        .schema(parts.schema)
        .from(parts.table)
        .select('status')
        .eq('id', id)
        .maybeSingle();
      if (error || !data) return;
      hear((data as { status?: unknown }).status);
    };

    const channel = supabase
      .channel(`run-going:${id}:${Math.random().toString(36).slice(2)}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: parts.schema, table: parts.table, filter: `id=eq.${id}` },
        (payload) => hear((payload.new as { status?: unknown } | null)?.status),
      )
      .subscribe((status) => {
        if (!gone && status === 'SUBSCRIBED') void read();
      });

    return () => {
      gone = true;
      void supabase.removeChannel(channel);
    };
  }, [followable, id, table]);

  if (!run) return false;
  return heard && heard.id === run.id ? heard.going : seed;
}
