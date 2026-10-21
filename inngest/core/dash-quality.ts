import 'server-only';

import { z } from 'zod';
import { createCoreServiceSupabase } from '@/inngest/core/supabase-admin';
import { createServiceSchemaSupabase, createServiceSupabase } from '@/inngest/supabase-admin';
import type { AskContext, AskDb, AskSchema, SchemaClient } from '@/lib/ask/db';
import { executeAskTool } from '@/lib/ask/tools';
import { loadAccountSettings } from '@/lib/core/account/settings';
import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import type { CoreOperation } from '@/lib/core/spend/operations';
import { costMicrosFor, type SpendReport } from '@/lib/core/spend/pricing';
import { recordSpend } from '@/lib/core/spend/record';
import { answerQuestion } from '@/lib/dash/ask';
import { dashModelFor } from '@/lib/dash/model-choice';
import type { HealthSpend, HealthTurn } from '@/lib/dash/quality/health';
import { runDashQuality, type DashQualityPorts } from '@/lib/dash/quality/run';
import { readMail } from '@/lib/inbox/read-mail';
import { searchMail } from '@/lib/inbox/search-mail';
import { readJobBoard } from '@/lib/jobs/discover/read-board';
import { todayInTimezone } from '@/lib/money';
import { allSearchSources } from '@/lib/search/registry';
import type { TalkToolCall } from '@/lib/talk/talk';

/**
 * The nightly Dash check's ports (lib/dash/quality/run.ts), called by
 * /api/cron/dash-quality from pg_cron (supabase/migrations/0277).
 *
 * Each case is asked as Ask asks it (answerQuestion with the person's chosen
 * model and every workspace they have on), with three differences: no write,
 * proposal, paid press or hand-off is offered, so the run changes nothing;
 * nothing is kept in their chats; and the lookups read through service-role
 * clients, since there is no session. Every lookup filters by the user id it
 * is given (AskContext), and the only id given is the owner's.
 */

const OPERATION: CoreOperation = 'check-dash-quality';

/** How many rows of a day's turns or spend are read; a day has far fewer. */
const DAY_ROWS = 2000;

function serviceAskDb(): AskDb {
  const made = new Map<AskSchema, SchemaClient>();
  return async (schema) => {
    let client = made.get(schema);
    if (!client) {
      client = createServiceSchemaSupabase(schema);
      made.set(schema, client);
    }
    return client;
  };
}

const ownerSchema = z.object({ userId: z.string().uuid() });

export function dashQualityPorts(core: CoreSupabaseClient): DashQualityPorts {
  const apiKey = process.env.ANTHROPIC_API_KEY ?? null;

  return {
    async owner() {
      const owner = await createServiceSupabase().rpc('app_owner');
      const parsed = ownerSchema.safeParse(owner.data);
      if (owner.error || !parsed.success) throw new Error('Could not resolve the owner to check for.');
      return parsed.data.userId;
    },

    async model(userId) {
      return dashModelFor(core, userId);
    },

    async cases(userId) {
      const { data, error } = await core
        .from('dash_eval_cases')
        .select('id, question, expect')
        .eq('user_id', userId)
        .eq('active', true)
        .order('created_at', { ascending: true });
      if (error) throw new Error(`Reading the cases failed: ${error.message}`);
      return (data ?? []) as { id: string; question: string; expect: unknown }[];
    },

    async ask(userId, question) {
      if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set on this deployment.');
      const settings = await loadAccountSettings(userId, core);
      const today = todayInTimezone(settings.timezone);
      const ctx: AskContext = {
        userId,
        today,
        timezone: settings.timezone,
        enabledModules: settings.enabledModules,
        db: serviceAskDb(),
        searchSources: allSearchSources(),
        searchMail: (search) => searchMail(core, userId, search),
        readMail: (message) => readMail(core, userId, message),
        readJobBoard,
      };
      const model = await dashModelFor(core, userId);
      const spent: SpendReport[] = [];
      const started = Date.now();
      const answer = await answerQuestion({
        turns: [{ role: 'user', body: question }],
        today,
        execute: (name, args) => executeAskTool(name, args, ctx),
        anthropicApiKey: apiKey,
        model,
        onSpend: (report) => spent.push(report),
      });
      const seconds = (Date.now() - started) / 1000;
      let costMicros = 0;
      for (const report of spent) {
        costMicros += costMicrosFor(report.model, report.usage) ?? 0;
        await recordSpend(core, userId, { module: 'core', operation: OPERATION, model: report.model, usage: report.usage });
      }
      const outcome = answer.ok
        ? { ok: true as const, body: answer.body, stop: answer.stop, citations: answer.citations, toolCalls: answer.toolCalls, seconds }
        : { ok: false as const, detail: answer.detail, toolCalls: answer.toolCalls, seconds };
      return { outcome, costMicros };
    },

    async turns(userId, since) {
      const { data, error } = await core
        .from('conversation_turns')
        .select('id, body, tool_calls, rating, rating_note, conversations!inner(subject_kind)')
        .eq('user_id', userId)
        .eq('role', 'assistant')
        .eq('conversations.subject_kind', 'ask')
        .gte('created_at', since)
        .limit(DAY_ROWS);
      if (error) throw new Error(`Reading the day's answers failed: ${error.message}`);
      return ((data ?? []) as {
        id: string;
        body: string;
        tool_calls: TalkToolCall[] | null;
        rating: 'up' | 'down' | null;
        rating_note: string | null;
      }[]).map(
        (row): HealthTurn => ({
          id: row.id,
          body: row.body,
          toolCalls: row.tool_calls,
          rating: row.rating,
          ratingNote: row.rating_note,
        }),
      );
    },

    async spend(userId, since) {
      const { data, error } = await core
        .from('model_spend')
        .select('input_tokens, cached_input_tokens, cache_write_tokens, output_tokens, cost_micros')
        .eq('user_id', userId)
        .eq('operation', 'ask-dash')
        .gte('created_at', since)
        .limit(DAY_ROWS);
      if (error) throw new Error(`Reading the day's spend failed: ${error.message}`);
      return ((data ?? []) as {
        input_tokens: number;
        cached_input_tokens: number;
        cache_write_tokens: number;
        output_tokens: number;
        cost_micros: number | null;
      }[]).map(
        (row): HealthSpend => ({
          inputTokens: row.input_tokens,
          cachedInputTokens: row.cached_input_tokens,
          cacheWriteTokens: row.cache_write_tokens,
          outputTokens: row.output_tokens,
          costMicros: row.cost_micros,
        }),
      );
    },

    async start(row) {
      const { data, error } = await core
        .from('dash_eval_runs')
        .insert({ user_id: row.userId, trigger: row.trigger, model: row.model, deploy: row.deploy })
        .select('id')
        .single();
      if (error || !data) throw new Error(`Starting the run failed: ${error?.message ?? 'no id'}`);
      return String((data as { id: string }).id);
    },

    async finish(id, row) {
      const { error } = await core
        .from('dash_eval_runs')
        .update({
          finished_at: new Date().toISOString(),
          cases: row.cases,
          passed: row.passed,
          results: row.results,
          health: row.health,
          cost_micros: row.costMicros,
          note_id: row.noteId,
          error: row.error,
        })
        .eq('id', id);
      if (error) throw new Error(`Saving the run failed: ${error.message}`);
    },

    async writeNote(userId, body) {
      // Straight into the queue as a bug on /ask, as the weekly reply check does.
      const { data, error } = await createServiceSupabase()
        .from('feedback_items')
        .insert({ user_id: userId, kind: 'bug', body, page_path: '/ask' })
        .select('id')
        .single();
      if (error || !data?.id) throw new Error(`Writing the Dev note failed: ${error?.message ?? 'no id'}`);
      return String(data.id);
    },
  };
}

export async function runDashQualityCheck(trigger: 'nightly' | 'manual') {
  const core = createCoreServiceSupabase();
  return runDashQuality(dashQualityPorts(core), {
    trigger,
    deploy: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? null,
  });
}
