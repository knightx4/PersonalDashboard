import 'server-only';

import { createCoreServiceSupabase } from '@/inngest/core/supabase-admin';
import { pushPorts } from '@/inngest/core/day-brief';
import { createGoalsServiceSupabase } from '@/inngest/goals/supabase-admin';
import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import {
  runStepDoneNotify,
  type DoneStep,
  type StepDonePorts,
  type StepDoneSummary,
} from '@/lib/goals/step-done-notify';

/**
 * The adapters behind the done-step phone message (plan #2376.3), called every
 * five minutes by pg_cron through /api/cron/goals-step-done
 * (supabase/migrations-goals/0084_step_done_cron.sql). What a pass does is in
 * lib/goals/step-done-notify.ts.
 *
 * The service clients bypass RLS. The one read across people is the list of
 * flagged steps, and each row carries its own user_id; every write after it
 * names that person.
 */

/** Enough for any five minutes of closes; the rest wait for the next pass. */
const STEP_ROWS = 200;

/** Deeper than any tree the goals page draws; stops a broken chain looping. */
const MAX_DEPTH = 12;

type ItemRow = { id: string; user_id: string; parent_id: string | null; level: string; title: string; result: string | null };

/** The goal a step sits under, by walking its parents. */
async function goalOf(goals: GoalsSupabaseClient, userId: string, parentId: string | null): Promise<string | null> {
  let id = parentId;
  for (let depth = 0; id && depth < MAX_DEPTH; depth += 1) {
    const { data, error } = await goals
      .from('items')
      .select('id, parent_id, level')
      .eq('user_id', userId)
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(`Reading a step's goal failed: ${error.message}`);
    const row = data as Pick<ItemRow, 'id' | 'parent_id' | 'level'> | null;
    if (!row) return null;
    if (row.level === 'goal') return row.id;
    id = row.parent_id;
  }
  return null;
}

export function stepDonePorts(goals: GoalsSupabaseClient, core: CoreSupabaseClient): StepDonePorts {
  return {
    async due(since) {
      const { data, error } = await goals
        .from('items')
        .select('id, user_id, parent_id, level, title, result')
        .eq('level', 'step')
        .eq('kind', 'claude')
        .eq('status', 'done')
        .eq('notify_on_done', true)
        .is('notified_at', null)
        .is('archived_at', null)
        .gte('closed_at', since.toISOString())
        .order('closed_at', { ascending: true })
        .limit(STEP_ROWS);
      if (error) throw new Error(`Reading the steps to announce failed: ${error.message}`);
      const rows = (data ?? []) as ItemRow[];
      const steps: DoneStep[] = [];
      for (const row of rows) {
        steps.push({
          id: row.id,
          userId: row.user_id,
          title: row.title,
          result: row.result,
          goalId: await goalOf(goals, row.user_id, row.parent_id),
        });
      }
      return steps;
    },

    async claim(step, at) {
      const { data, error } = await goals
        .from('items')
        .update({ notified_at: at.toISOString() })
        .eq('user_id', step.userId)
        .eq('id', step.id)
        .is('notified_at', null)
        .select('id');
      if (error) throw new Error(`Marking the step announced failed: ${error.message}`);
      return (data ?? []).length > 0;
    },

    async release(step) {
      const { error } = await goals
        .from('items')
        .update({ notified_at: null })
        .eq('user_id', step.userId)
        .eq('id', step.id);
      if (error) throw new Error(`Clearing the step's announcement failed: ${error.message}`);
    },

    push(userId) {
      return pushPorts(core, userId);
    },
  };
}

export async function runStepDone(now: Date = new Date()): Promise<StepDoneSummary> {
  const ports = stepDonePorts(createGoalsServiceSupabase(), createCoreServiceSupabase());
  return runStepDoneNotify(ports, now);
}
