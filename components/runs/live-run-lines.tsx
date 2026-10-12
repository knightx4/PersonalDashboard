'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/auth/client';
import {
  RUN_ACTIVITY_COLUMNS,
  mergeRunLines,
  runActivityFrom,
  type RunActivity,
  type RunTable,
} from '@/lib/core/run-activities';
import { RunLinesView, type RunLinesConnection, type RunLinesState } from './run-lines';

/** Where each runs table lives, for a Realtime subscription to its rows. */
const RUN_ROW: Record<RunTable, { schema: string; table: string }> = {
  plan_runs: { schema: 'public', table: 'plan_runs' },
  'goals.runs': { schema: 'goals', table: 'runs' },
};

/**
 * A run's lines, filling in as Dash writes them (plan #1826).
 *
 * While the run is going it holds one Realtime channel: inserts into
 * core.run_activities for this run, which are appended in place, and updates
 * to the run's own row, which refresh the page so its status, summary and
 * changes follow the run without the 15-second polling the goal pages used.
 * It subscribes before it reads, and mergeRunLines drops the line that
 * arrives both ways. Realtime reads each event through the viewer's RLS, so
 * only the run's owner hears anything.
 *
 * `initial` is the lines the server already read; left out, the lines are
 * read here once the channel is open, as on a plan step, whose row is opened
 * in the browser.
 */
export function LiveRunLines({
  runTable,
  runId,
  state,
  initial,
  acknowledge,
  className,
}: {
  runTable: RunTable;
  runId: string;
  state: RunLinesState;
  initial?: readonly RunActivity[];
  acknowledge?: React.ReactNode;
  className?: string;
}) {
  const router = useRouter();
  const [lines, setLines] = useState<RunActivity[]>(() => mergeRunLines([], initial ?? []));
  const [connection, setConnection] = useState<RunLinesConnection>('connecting');
  const following = state === 'live' || state === 'waiting';
  const readHere = initial === undefined;

  useEffect(() => {
    const supabase = createClient();
    let gone = false;

    const read = async () => {
      const { data, error } = await supabase
        .schema('core')
        .from('run_activities')
        .select(RUN_ACTIVITY_COLUMNS)
        .eq('run_id', runId)
        .order('created_at', { ascending: true })
        .limit(500);
      if (gone || error) return;
      const read = (data ?? [])
        .map((row) => runActivityFrom(row as Record<string, unknown>))
        .filter((line): line is RunActivity => line !== null);
      setLines((held) => mergeRunLines(held, read));
    };

    if (!following) {
      if (readHere) void read();
      return () => {
        gone = true;
      };
    }

    const row = RUN_ROW[runTable];
    const channel = supabase
      .channel(`run-lines:${runId}:${Math.random().toString(36).slice(2)}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'core', table: 'run_activities', filter: `run_id=eq.${runId}` },
        (payload) => {
          const line = runActivityFrom(payload.new as Record<string, unknown>);
          if (line) setLines((held) => mergeRunLines(held, [line]));
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: row.schema, table: row.table, filter: `id=eq.${runId}` },
        () => router.refresh(),
      )
      .subscribe((status) => {
        if (gone) return;
        if (status === 'SUBSCRIBED') {
          setConnection('open');
          // Read after subscribing, so no line falls between the two. A
          // server-read page reads again too: a line written while the page
          // was on its way is in neither.
          void read();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          setConnection('lost');
        }
      });

    return () => {
      gone = true;
      void supabase.removeChannel(channel);
    };
  }, [following, readHere, router, runId, runTable]);

  // A run that has ended having written nothing draws nothing: every run
  // from before plan #1822, and any whose skill does not write lines yet.
  if (state === 'ended' && lines.length === 0) return null;

  return (
    <RunLinesView
      lines={lines}
      state={state}
      connection={following ? connection : 'open'}
      acknowledge={acknowledge}
      className={className}
    />
  );
}
