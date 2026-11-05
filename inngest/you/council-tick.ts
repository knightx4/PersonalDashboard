import 'server-only';

import { z } from 'zod';
import { createServiceSchemaSupabase, createServiceSupabase } from '@/inngest/supabase-admin';
import { createCoreServiceSupabase } from '@/inngest/core/supabase-admin';
import { boardRoutine, type RoutineTarget } from '@/lib/feedback/routine';
import type { YouSupabaseClient } from '@/lib/you/db/schema-name';
import { maybeStartAdviceRun } from '@/lib/you/council';
import { isQuietHours } from '@/lib/you/council-texts';
import type { SchemaReader } from '@/lib/you/reach-out-due';

/**
 * The Council's daily round, a stage of the daily cron (you 0037). Once a day
 * it asks lib/you/council.ts whether the owner's mentors may write: not while
 * a round is open, not twice in a day, and not while six notes are unread or
 * three were written today, so notes never pile up while the person is away.
 * When they may, or when a mentor conversation is over and due a summary
 * (plan #2748.8), it fires the board routine with the council skill's advice
 * brief. A person on People with a reach-out rule speaks only when it makes
 * them due (lib/you/reach-out-due.ts, plan #2931.5), which reads the tables
 * their rule watches. The stage costs a few reads; the session runs on the
 * person's plan.
 *
 * Mentors text the person (plan #2748.7), so nothing starts in their quiet
 * hours, 22:00 to 08:00 in their zone. The five-minute council-texts call
 * (inngest/you/council-texts.ts) runs this too, so the round starts at the
 * first call after their morning begins.
 */
export async function runCouncilTick(deps?: {
  you?: YouSupabaseClient;
  userId?: string;
  now?: number;
  routine?: RoutineTarget;
  fetch?: typeof globalThis.fetch;
  /** The person's time zone; read from core.account_settings when not given. */
  timezone?: string;
  /** A client per schema, for the tables reach-out rules watch (plan #2931.5). */
  db?: SchemaReader;
}): Promise<{ skipped: string } | { started: true; runId: string }> {
  let userId = deps?.userId;
  if (!userId) {
    const owner = await createServiceSupabase().rpc('app_owner');
    const parsed = z.object({ userId: z.string().uuid() }).safeParse(owner.data);
    if (owner.error || !parsed.success) throw new Error('Could not resolve the owner for the council round.');
    userId = parsed.data.userId;
  }
  const you = deps?.you ?? (createServiceSchemaSupabase('you') as unknown as YouSupabaseClient);
  const now = deps?.now ?? Date.now();
  let timezone = deps?.timezone;
  if (!timezone) {
    const settings = await createCoreServiceSupabase()
      .from('account_settings')
      .select('timezone')
      .eq('user_id', userId)
      .maybeSingle();
    if (settings.error) throw new Error(`Reading the time zone failed: ${settings.error.message}`);
    timezone = (settings.data as { timezone?: string } | null)?.timezone || 'UTC';
  }
  return maybeStartAdviceRun({
    client: you,
    userId,
    quiet: isQuietHours(new Date(now), timezone),
    db: deps?.db ?? createServiceSchemaSupabase,
    routine: deps?.routine ?? boardRoutine(),
    now,
    fetch: deps?.fetch,
  });
}
