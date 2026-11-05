import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { createCoreServiceSupabase } from '@/inngest/core/supabase-admin';
import { createServiceSchemaSupabase, createServiceSupabase } from '@/inngest/supabase-admin';
import type { AskContext, AskDb, AskSchema, SchemaClient } from '@/lib/ask/db';
import { executeAskTool } from '@/lib/ask/tools';
import { loadAccountSettings } from '@/lib/core/account/settings';
import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import type { CoreOperation } from '@/lib/core/spend/operations';
import { costMicrosFor, usageFrom, type SpendReport } from '@/lib/core/spend/pricing';
import { recordSpend } from '@/lib/core/spend/record';
import { devAccess } from '@/lib/ask/dev';
import { answerQuestion } from '@/lib/dash/ask';
import { codeDeps } from '@/lib/dash/think-code';
import { dashModelFor } from '@/lib/dash/model-choice';
import type { HealthConnectorCall, HealthSpend, HealthTurn } from '@/lib/dash/quality/health';
import { runModelCheck, type ModelCheckPorts } from '@/lib/dash/quality/model-replies';
import { rehearsePaid } from '@/lib/dash/quality/rehearse-paid';
import { runDashQuality, type DashQualityPorts, type DashQualityTrigger } from '@/lib/dash/quality/run';
import { readMail } from '@/lib/inbox/read-mail';
import { searchMail } from '@/lib/inbox/search-mail';
import { readJobBoard } from '@/lib/jobs/discover/read-board';
import { todayInTimezone } from '@/lib/money';
import { allSearchSources } from '@/lib/search/registry';
import type { TalkToolCall } from '@/lib/talk/talk';
import { answerAsAdvisor } from '@/lib/you/advisor-talk-run';
import { loadTalkContext } from '@/lib/you/advisor-talk-store';
import type { YouSupabaseClient } from '@/lib/you/db/schema-name';
import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';

/**
 * The Dash check's ports (lib/dash/quality/run.ts), called by
 * /api/cron/dash-quality from pg_cron: the free health read daily, the cases
 * monthly (supabase/migrations/0277, 0279).
 *
 * Each case is asked as Ask asks it (answerQuestion with the person's chosen
 * model and every workspace they have on), with three differences: no write,
 * proposal or hand-off is offered, and a paid press is checked but never kept
 * (lib/dash/quality/rehearse-paid.ts), so the run changes and spends nothing;
 * nothing is kept in their chats; and the lookups read through service-role
 * clients, since there is no session. Every lookup filters by the user id it
 * is given (AskContext), and the only id given is the owner's. A case that
 * names an advisor (core.dash_eval_cases.advisor, plan #2581.6) is put to
 * them as the first message of a talk, with the same lookups, and nothing of
 * the talk is kept. A case with `think` on is asked with Think it through, as
 * the person presses it (plan #2937.6).
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
      let query = core.from('dash_eval_cases').select('id, question, expect, advisor, think').eq('user_id', userId);
      query = only ? query.eq('id', only) : query.eq('active', true);
      const { data, error } = await query.order('created_at', { ascending: true });
      if (error) throw new Error(`Reading the cases failed: ${error.message}`);
      return (data ?? []) as { id: string; question: string; expect: unknown; advisor: string | null; think: boolean }[];
    },

    async ask(userId, question, advisor, think) {
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
      const execute = (name: string, args: unknown) => executeAskTool(name, args, ctx);
      // A case put to an advisor (plan #2581.6) is their reply to a first
      // message, from their brain and memory; nothing is kept.
      let talk: Awaited<ReturnType<typeof loadTalkContext>> = null;
      if (advisor) {
        talk = await loadTalkContext(
          createServiceSchemaSupabase('you') as unknown as YouSupabaseClient,
          createServiceSchemaSupabase('goals') as unknown as GoalsSupabaseClient,
          userId,
          advisor,
        );
        if (!talk) throw new Error(`There is no advisor ${advisor} on the board.`);
      }
      const started = Date.now();
      const answer = talk
        ? await answerAsAdvisor({
            context: talk.context,
            turns: [{ role: 'user', body: question }],
            today,
            execute,
            anthropicApiKey: apiKey,
            onSpend: (report) => spent.push(report),
          })
        : await answerQuestion({
            turns: [{ role: 'user', body: question }],
            today,
            execute,
            queue: rehearsePaid(ctx),
            anthropicApiKey: apiKey,
            model,
            // Think it through (plan #2937.6): Opus, the code and the mockup, as the person's press asks it.
            think: think ? { ...codeDeps(), codeAccess: () => devAccess(ctx) } : null,
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
        .in('conversations.subject_kind', ['ask', 'row'])
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

    async connectorCalls(userId, since) {
      const { data, error } = await core
        .from('connector_calls')
        .select('id, tool, outcome, error')
        .eq('user_id', userId)
        .gte('created_at', since)
        .limit(DAY_ROWS);
      if (error) throw new Error(`Reading the day's connector calls failed: ${error.message}`);
      return (data ?? []) as HealthConnectorCall[];
    },

    async failures(userId, since) {
      const { data, error } = await core
        .from('dash_failures')
        .select('id, surface, outcome, reason, model, calls')
        .eq('user_id', userId)
        .gte('created_at', since)
        .order('created_at', { ascending: true })
        .limit(DAY_ROWS);
      if (error) throw new Error(`Reading the day's failed answers failed: ${error.message}`);
      return ((data ?? []) as { id: string; surface: string; outcome: 'failed' | 'unfinished'; reason: string; model: string; calls: unknown }[]).map(
        (row) => ({
          id: row.id,
          surface: row.surface,
          outcome: row.outcome,
          reason: row.reason,
          model: row.model,
          stops: Array.isArray(row.calls) ? row.calls.map((call) => ((call as { stop?: unknown })?.stop as string | null) ?? null) : [],
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

const MODEL_OPERATION: CoreOperation = 'check-model-replies';

/**
 * The daily model reply check's ports (lib/dash/quality/model-replies.ts,
 * plan #2937.7): each probe sent as written, its tokens kept as spend, and
 * the run kept in core.dash_eval_runs under trigger 'models'. It reads none
 * of the person's rows; the owner is only whose spend and note it is.
 */
export function modelCheckPorts(core: CoreSupabaseClient): ModelCheckPorts {
  const apiKey = process.env.ANTHROPIC_API_KEY ?? null;
  const quality = dashQualityPorts(core);
  let client: Anthropic | null = null;

  return {
    owner: () => quality.owner(),

    async call(request) {
      if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set on this deployment.');
      client ??= new Anthropic({ apiKey, maxRetries: 1 });
      const started = Date.now();
      const options = request.beta.length > 0 ? { headers: { 'anthropic-beta': request.beta.join(',') } } : undefined;
      try {
        const reply = await client.messages.create(request.params, options);
        return { ok: true, reply, usage: usageFrom(reply.usage), seconds: (Date.now() - started) / 1000 };
      } catch (err) {
        if (err instanceof Anthropic.APIError) {
          return { ok: false, status: typeof err.status === 'number' ? err.status : null, message: err.message, seconds: (Date.now() - started) / 1000 };
        }
        throw err;
      }
    },

    async spend(userId, model, usage) {
      await recordSpend(core, userId, { module: 'core', operation: MODEL_OPERATION, model, usage });
    },

    async start(row) {
      const { data, error } = await core
        .from('dash_eval_runs')
        .insert({ user_id: row.userId, trigger: 'models', model: row.models, deploy: row.deploy })
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
          cost_micros: row.costMicros,
          note_id: row.noteId,
          error: row.error,
        })
        .eq('id', id);
      if (error) throw new Error(`Saving the run failed: ${error.message}`);
    },

    writeNote: (userId, body) => quality.writeNote(userId, body),
  };
}

export async function runModelReplyCheck() {
  return runModelCheck(modelCheckPorts(createCoreServiceSupabase()), {
    deploy: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? null,
  });
}
