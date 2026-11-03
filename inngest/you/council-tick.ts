import 'server-only';

import { z } from 'zod';
import { createServiceSchemaSupabase, createServiceSupabase } from '@/inngest/supabase-admin';
import { boardRoutine, type RoutineTarget } from '@/lib/feedback/routine';
import type { YouSupabaseClient } from '@/lib/you/db/schema-name';
import { maybeStartAdviceRun } from '@/lib/you/council';

/**
 * The Council's daily round, a stage of the daily cron (you 0037). Once a day
 * it asks lib/you/council.ts whether the owner's mentors may write: not while
 * a round is open, not twice in a day, and not while six notes are unread or
 * three were written today, so notes never pile up while the person is away.
 * When they may, it fires the board routine with the council skill's advice
 * brief. The stage costs a few reads; the session runs on the person's plan.
 */
export async function runCouncilTick(deps?: {
  you?: YouSupabaseClient;
  userId?: string;
  now?: number;
  routine?: RoutineTarget;
  fetch?: typeof globalThis.fetch;
}): Promise<{ skipped: string } | { started: true; runId: string }> {
  let userId = deps?.userId;
  if (!userId) {
    const owner = await createServiceSupabase().rpc('app_owner');
    const parsed = z.object({ userId: z.string().uuid() }).safeParse(owner.data);
    if (owner.error || !parsed.success) throw new Error('Could not resolve the owner for the council round.');
    userId = parsed.data.userId;
  }
  const you = deps?.you ?? (createServiceSchemaSupabase('you') as unknown as YouSupabaseClient);
  return maybeStartAdviceRun({
    client: you,
    userId,
    routine: deps?.routine ?? boardRoutine(),
    now: deps?.now,
    fetch: deps?.fetch,
  });
}
