'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/auth/client';
import type { RunActivity } from '@/lib/core/run-activities';
import { goingRunCutoff, newestGoingRun, runHref, type GoingRun } from '@/lib/core/run-link';
import { runTableParts } from '@/lib/core/run-going';
import { useNewestRunLines } from '@/components/runs/use-newest-run-lines';

/** What the status line says while Dash is on something. */
export type GoingRunLine = {
  href: string;
  /** The run's newest line in its own words; null before it has written one. */
  line: RunActivity | null;
};

const TABLES = ['plan_runs', 'goals.runs'] as const;

/**
 * The newest run still going and its latest line, for the status line
 * (plan #1964.2.3).
 *
 * One channel on every change to either runs table, subscribed before the
 * read: a run starting is an insert and one ending is an update, and either
 * sends the two small reads again rather than the hook reasoning about which
 * run an event was. The newest line then comes from `useNewestRunLines`, the
 * same Realtime follow a run's own page uses. Realtime and the reads both go
 * through the viewer's RLS, so only the owner ever sees a run. A failed read
 * leaves what was held; the next event corrects it.
 *
 * `fixture` is for the gallery, which draws the line without a database.
 */
export function useGoingRunLine(fixture?: GoingRunLine | null): GoingRunLine | null {
  const [run, setRun] = useState<GoingRun | null>(null);
  const fixed = fixture !== undefined;

  useEffect(() => {
    if (fixed) return;
    const supabase = createClient();
    let gone = false;

    const read = async () => {
      const since = goingRunCutoff(Date.now());
      const found = await Promise.all(
        TABLES.map(async (table): Promise<GoingRun | null | undefined> => {
          const parts = runTableParts(table);
          const { data, error } = await supabase
            .schema(parts.schema)
            .from(parts.table)
            .select('id, created_at')
            .eq('status', 'started')
            .gte('created_at', since)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          if (error) return undefined;
          const row = data as { id?: string; created_at?: string } | null;
          return row?.id && row.created_at ? { table, id: row.id, created_at: row.created_at } : null;
        }),
      );
      // A read that failed leaves the answer as it was.
      if (gone || found.some((one) => one === undefined)) return;
      setRun(newestGoingRun(found));
    };

    let channel = supabase.channel(`going-run:${Math.random().toString(36).slice(2)}`);
    for (const table of TABLES) {
      const parts = runTableParts(table);
      channel = channel.on(
        'postgres_changes',
        { event: '*', schema: parts.schema, table: parts.table },
        () => void read(),
      );
    }
    channel.subscribe((status) => {
      if (!gone && status === 'SUBSCRIBED') void read();
    });

    return () => {
      gone = true;
      void supabase.removeChannel(channel);
    };
  }, [fixed]);

  const lines = useNewestRunLines(!fixed && run ? [run.id] : []);
  if (fixed) return fixture;
  if (!run) return null;
  return { href: runHref(run.table, run.id), line: lines.get(run.id) ?? null };
}
