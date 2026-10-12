'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/auth/client';

/**
 * Refresh the page when one of your goal runs changes, while one is going
 * (plan #1826).
 *
 * Replaces the 15-second router.refresh() polling the goal page, its step
 * tree and the area planner each kept while a run was going. The goals skill
 * writes the run row at each step it starts (last_seen_at and now_on) and
 * when it ends, and goals.runs is in the supabase_realtime publication
 * (0199_runs_realtime.sql), so an update to the row is the moment there is
 * something new to draw. Realtime reads each event through the viewer's RLS,
 * so only your own runs are heard. Several updates close together refresh
 * once.
 */
const SETTLE_MS = 750;

export function useRunRefresh(active: boolean) {
  const router = useRouter();

  useEffect(() => {
    if (!active) return;
    const supabase = createClient();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const channel = supabase
      .channel(`goal-runs:${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'goals', table: 'runs' }, () => {
        if (timer) return;
        timer = setTimeout(() => {
          timer = null;
          router.refresh();
        }, SETTLE_MS);
      })
      .subscribe();

    return () => {
      if (timer) clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [active, router]);
}
