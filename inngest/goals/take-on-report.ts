import 'server-only';

import { createCoreServiceSupabase } from '@/inngest/core/supabase-admin';
import { pushPorts } from '@/inngest/core/day-brief';
import { createGoalsServiceSupabase } from '@/inngest/goals/supabase-admin';
import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import { TAKE_ON_ORIGINS, type EndedQuestion, type TakeOnOrigin } from '@/lib/goals/take-on';
import { runTakeOnReports, type TakeOnReportPorts, type TakeOnSummary } from '@/lib/goals/take-on-report';

/**
 * The adapters behind reporting back on a question handed to a goal (plan
 * #2778.8), run by /api/cron/goals-step-done every five minutes beside the
 * done-step message. What a pass does is in lib/goals/take-on-report.ts.
 *
 * The service clients bypass RLS. The one read across people is the list of
 * ended question runs, and each row carries its own user_id; every read and
 * write after it names that person.
 */

/** Enough for any five minutes of ends; the rest wait for the next pass. */
const RUN_ROWS = 100;

type RunRow = {
  id: string;
  user_id: string;
  item_id: string | null;
  status: string;
  question: string;
  origin: string;
  origin_ref: string | null;
  summary: string | null;
  error: string | null;
};

export function takeOnPorts(goals: GoalsSupabaseClient, core: CoreSupabaseClient): TakeOnReportPorts {
  return {
    async due(since) {
      const { data, error } = await goals
        .from('runs')
        .select('id, user_id, item_id, status, question, origin, origin_ref, summary, error')
        .not('question', 'is', null)
        .is('reported_at', null)
        .in('status', ['done', 'failed'])
        .gte('ended_at', since.toISOString())
        .order('ended_at', { ascending: true })
        .limit(RUN_ROWS);
      if (error) throw new Error(`Reading the questions to report failed: ${error.message}`);
      const out: EndedQuestion[] = [];
      for (const row of (data ?? []) as RunRow[]) {
        let goalTitle: string | null = null;
        if (row.item_id) {
          const { data: item } = await goals
            .from('items')
            .select('title')
            .eq('user_id', row.user_id)
            .eq('id', row.item_id)
            .maybeSingle();
          goalTitle = (item as { title: string } | null)?.title ?? null;
        }
        const { count } = await goals
          .from('suggestions')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', row.user_id)
          .eq('run_id', row.id)
          .in('kind', ['step', 'tile'])
          .is('reaction', null);
        out.push({
          runId: row.id,
          userId: row.user_id,
          goalId: row.item_id,
          goalTitle,
          question: row.question,
          origin: (TAKE_ON_ORIGINS as readonly string[]).includes(row.origin)
            ? (row.origin as TakeOnOrigin)
            : 'chat',
          originRef: row.origin_ref,
          status: row.status === 'done' ? 'done' : 'failed',
          summary: row.summary,
          error: row.error,
          suggested: count ?? 0,
        });
      }
      return out;
    },

    async claim(run, at) {
      const { data, error } = await goals
        .from('runs')
        .update({ reported_at: at.toISOString() })
        .eq('user_id', run.userId)
        .eq('id', run.runId)
        .is('reported_at', null)
        .select('id');
      if (error) throw new Error(`Marking the question reported failed: ${error.message}`);
      return (data ?? []).length > 0;
    },

    async release(run) {
      const { error } = await goals
        .from('runs')
        .update({ reported_at: null })
        .eq('user_id', run.userId)
        .eq('id', run.runId);
      if (error) throw new Error(`Clearing the question's report failed: ${error.message}`);
    },

    async reply(run, line) {
      // The conversation must be the person's own Ask Dash chat.
      const { data: conversation, error: readError } = await core
        .from('conversations')
        .select('id')
        .eq('user_id', run.userId)
        .eq('id', run.originRef ?? '')
        .eq('subject_kind', 'ask')
        .maybeSingle();
      if (readError) throw new Error(`Reading the conversation failed: ${readError.message}`);
      if (!conversation) return;
      const { error } = await core.from('conversation_turns').insert({
        conversation_id: (conversation as { id: string }).id,
        user_id: run.userId,
        role: 'assistant',
        body: line.body,
        citations: line.citations.length > 0 ? line.citations : null,
      });
      if (error) throw new Error(`Writing the reply line failed: ${error.message}`);
    },

    push(userId) {
      return pushPorts(core, userId);
    },
  };
}

export async function runTakeOnReport(now: Date = new Date()): Promise<TakeOnSummary> {
  return runTakeOnReports(takeOnPorts(createGoalsServiceSupabase(), createCoreServiceSupabase()), now);
}
