import 'server-only';

import { createCoreServiceSupabase } from '@/inngest/core/supabase-admin';
import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import { runBrowserWait, type BrowserWaitPorts, type BrowserWaitResult } from '@/lib/talk/browser-wait';
import { BROWSER_WAIT_MS, fireSessionHandoff } from '@/lib/talk/handoff-fire';
import { loadWaitedBrowserHandoffs } from '@/lib/talk/handoffs';
import { loadRunnerStatuses, runnerStatusSentence } from '@/lib/talk/browser-runners';

/**
 * The browser task sweep (plan #3040.4), called every minute by pg_cron
 * through /api/cron/browser-handoffs (supabase/migrations/0313_browser_task_wait.sql).
 * The rules are lib/talk/browser-wait.ts; this fills in its ports.
 *
 * Browser tasks are the owner's alone, as the claims are (migration 0312):
 * the runners on the PC and the Mac claim only the owner's rows. The service
 * client bypasses RLS, so every read and write names the owner's id.
 */

export function browserWaitPorts(core: CoreSupabaseClient, ownerId: string): BrowserWaitPorts {
  return {
    async releaseStale() {
      const { data, error } = await core.rpc('release_stale_browser_claims');
      if (error) throw new Error(`Letting go of quiet claims failed: ${error.message}`);
      return typeof data === 'number' ? data : 0;
    },
    waited: (keptBy) => loadWaitedBrowserHandoffs(core, ownerId, keptBy),
    fire: (handoff) => fireSessionHandoff(core, ownerId, handoff, { afterWait: true }),
    async say(handoff, text) {
      const { error } = await core.rpc('say_in_handoff_thread', { p_handoff: handoff.id, p_text: text });
      if (error) throw new Error(error.message);
    },
    async runners() {
      const now = Date.now();
      const statuses = await loadRunnerStatuses(core, ownerId, now);
      return statuses ? runnerStatusSentence(statuses, now) : null;
    },
  };
}

export async function runBrowserHandoffs(
  now: Date = new Date(),
): Promise<{ owner: boolean } & Partial<BrowserWaitResult>> {
  const core = createCoreServiceSupabase();
  const { data: ownerId, error } = await core.rpc('dev_owner_id');
  if (error) throw new Error(`Reading the owner failed: ${error.message}`);
  if (typeof ownerId !== 'string' || !ownerId) return { owner: false };
  return { owner: true, ...(await runBrowserWait(browserWaitPorts(core, ownerId), now, BROWSER_WAIT_MS)) };
}
