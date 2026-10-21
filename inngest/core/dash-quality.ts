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
import { runDashQuality, type DashQualityPorts, type DashQualityTrigger } from '@/lib/dash/quality/run';
import { readMail } from '@/lib/inbox/read-mail';
import { searchMail } from '@/lib/inbox/search-mail';
import { readJobBoard } from '@/lib/jobs/discover/read-board';
import { todayInTimezone } from '@/lib/money';
import { allSearchSources } from '@/lib/search/registry';
import type { TalkToolCall } from '@/lib/talk/talk';

/**
 * The Dash check's ports (lib/dash/quality/run.ts), called by
 * /api/cron/dash-quality from pg_cron: the free health read daily, the cases
 * monthly (supabase/migrations/0277, 0279).
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

/**
 * The lookups' clients, service-role, for the owner. `public.is_owner()`
 * reads the signed-in session, which a cron run has none of, so it would say
 * no and every Dev lookup would fail here though it works for them in the
 * app. The run only ever asks as the account `app_owner()` named, so that one
 * call is answered yes; every other call goes to the database.
 */
function ownerAskDb(): AskDb {
  const made = new Map<AskSchema, SchemaClient>();
  return async (schema) => {
    let client = made.get(schema);
    if (!client) {
      const service = createServiceSchemaSupabase(schema);
      client =
        schema === 'public'
          ? (new Proxy(service, {
              get(target, key, receiver) {
                if (key !== 'rpc') return Reflect.get(target, key, receiver);
                return (fn: string, ...rest: unknown[]) =>
                  fn === 'is_owner'
                    ? Promise.resolve({ data: true, error: null })
                    : (target.rpc as (...args: unknown[]) => unknown).call(target, fn, ...rest);
              },
            }) as SchemaClient)
          : service;
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

    async cases(userId, only) {
      let query = core.from('dash_eval_cases').select('id, question, expect').eq('user_id', userId);
      query = only ? query.eq('id', only) : query.eq('active', true);
      const { data, error } = await query.order('created_at', { ascending: true });
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
        db: ownerAskDb(),
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
        .select('id, conversation_id, created_at, body, tool_calls, rating, rating_note, conversations!inner(subject_kind)')
        .eq('user_id', userId)
        .eq('role', 'assistant')
        .eq('conversations.subject_kind', 'ask')
        .gte('created_at', since)
        .limit(DAY_ROWS);
      if (error) throw new Error(`Reading the day's answers failed: ${error.message}`);
      const rows = (data ?? []) as {
        id: string;
        conversation_id: string;
        created_at: string;
        body: string;
        tool_calls: TalkToolCall[] | null;
        rating: 'up' | 'down' | null;
        rating_note: string | null;
      }[];
      // What the person wrote next in each chat, for the pushback check.
      const replies = new Map<string, { created_at: string; body: string }[]>();
      const chats = [...new Set(rows.map((row) => row.conversation_id))];
      for (let i = 0; i < chats.length; i += 200) {
        const { data: said, error: saidError } = await core
          .from('conversation_turns')
          .select('conversation_id, created_at, body')
          .eq('user_id', userId)
          .eq('role', 'user')
          .in('conversation_id', chats.slice(i, i + 200))
          .gte('created_at', since)
          .order('created_at', { ascending: true })
          .limit(DAY_ROWS);
        if (saidError) throw new Error(`Reading the day's replies failed: ${saidError.message}`);
        for (const row of (said ?? []) as { conversation_id: string; created_at: string; body: string }[]) {
          const list = replies.get(row.conversation_id) ?? [];
          list.push(row);
          replies.set(row.conversation_id, list);
        }
      }
      return rows.map(
        (row): HealthTurn => ({
          id: row.id,
          body: row.body,
          toolCalls: row.tool_calls,
          rating: row.rating,
          ratingNote: row.rating_note,
          followUp: replies.get(row.conversation_id)?.find((reply) => reply.created_at > row.created_at)?.body ?? null,
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

export async function runDashQualityCheck(trigger: DashQualityTrigger, only: string | null = null) {
  const core = createCoreServiceSupabase();
  return runDashQuality(dashQualityPorts(core), {
    trigger,
    only,
    deploy: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? null,
  });
}
