import type { SupabaseClient } from '@supabase/supabase-js';
import { isUuid } from '@/lib/ask/db';
import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import { toRef } from '@/lib/core/refs';
import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import type { NewsSupabaseClient } from '@/lib/news/db/schema-name';
import { makeRecommendations } from '@/lib/news/recommend/make';
import { ESTIMATE_BATCH_LIMIT } from '@/lib/sell/price-run';
import { priceItemsFor } from '@/lib/sell/price-items-run';
import type { VaultSupabaseClient } from '@/lib/vault/db/schema-name';
import { askMayaAbout } from '@/lib/vault/maya/ask-run';
import { noteRef } from '@/lib/vault/maya/store';
import { mayaThreadHref, noteHref } from '@/lib/vault/paths';
import type { YouSupabaseClient } from '@/lib/you/db/schema-name';
import { EDUCATION_HREF } from '@/lib/you/education';
import { runPersonalityRead } from '@/lib/you/personality/read-run';
import { readResumeIntoWorkHistory } from '@/lib/you/work-history-run';
import type { DashPaidCheckContext, DashPaidPrepared, DashPaidTool } from './registry';

/**
 * Dash's paid tools in Vault, News, Shopping and You (plan #2228.5, under
 * #2228): the buttons there that spend money and make sense asked for in
 * words. Each is queued on a card with its estimate and runs, once approved,
 * through the function its button's server action calls (`runs`), as
 * lib/dash/paid-tools.ts says.
 *
 * The buttons in those workspaces, and in Goals, that spend and have no tool
 * here say why in their catalogue entries (lib/<module>/agent-actions.ts).
 */

const QUEUED =
  'It costs money, so calling this runs nothing: it is queued on a card under your answer with its estimated cost, and runs only when they approve it.';

type Input = Record<string, unknown>;

const inputOf = (input: unknown): Input => (input && typeof input === 'object' ? (input as Input) : {});

const text = (input: Input, key: string): string => (typeof input[key] === 'string' ? (input[key] as string).trim() : '');

const NO_KEY: DashPaidPrepared = {
  ok: false,
  error: 'This deployment has no Anthropic API key set, so Dash cannot run this.',
};

const hasKey = () => Boolean(process.env.ANTHROPIC_API_KEY);

async function youOf(ctx: { db: DashPaidCheckContext['db'] }): Promise<YouSupabaseClient> {
  return (await ctx.db('you')) as unknown as YouSupabaseClient;
}

async function vaultOf(ctx: { db: DashPaidCheckContext['db'] }): Promise<VaultSupabaseClient> {
  return (await ctx.db('obsidian')) as unknown as VaultSupabaseClient;
}

async function coreOf(ctx: { db: DashPaidCheckContext['db'] }): Promise<CoreSupabaseClient> {
  return (await ctx.db('core')) as unknown as CoreSupabaseClient;
}

/** Read again on a personality result, on You's Personality tab (plan #1635). */
const readPersonalityTool: DashPaidTool = {
  name: 'read_personality_again',
  kind: 'paid',
  inAppOnly: true,
  action: 'app/you/personality/actions.ts#readAgainAction',
  runs: 'lib/you/personality/read-run.ts#runPersonalityRead',
  workspace: 'you',
  definition: {
    name: 'read_personality_again',
    description: `Have Dash read one of their personality results (a Big Five test, Myers-Briggs, Enneagram or another) again against their notes, replacing the earlier read, when they ask for a fresh one. ${QUEUED}`,
    input_schema: {
      type: 'object',
      properties: {
        result_id: { type: 'string', description: 'The you.personality_results id to read again.' },
      },
      required: ['result_id'],
      additionalProperties: false,
    },
  },
  async prepare(ctx, input) {
    const resultId = text(inputOf(input), 'result_id');
    if (!isUuid(resultId)) return { ok: false, error: 'Name the personality result by its id.' };
    if (!hasKey()) return NO_KEY;
    const you = await youOf(ctx);
    const { data, error } = await you.from('personality_results').select('id, test_name').eq('id', resultId).maybeSingle();
    if (error) return { ok: false, error: 'The result could not be checked against the database.' };
    if (!data) return { ok: false, error: 'That personality result is not one of theirs.' };
    const name = String((data as { test_name: string }).test_name);
    return {
      ok: true,
      args: { resultId, name },
      line: `Read your ${name} result again against your notes.`,
      paths: ['/you/personality'],
    };
  },
  async run(ctx, args) {
    const resultId = String(args.resultId);
    const outcome = await runPersonalityRead(await youOf(ctx), ctx.userId, resultId);
    if (!outcome.ok) return { ok: false, error: 'Dash could not read it just now. Try again.' };
    return {
      ok: true,
      subjectRef: toRef('you.personality_results', resultId),
      op: 'update',
      summary: `Dash read your ${String(args.name)} result again against your notes: ${outcome.points} points.`,
    };
  },
};

/** Read from résumé on You's Work & school tab (plan #1991.4). */
const readResumeTool: DashPaidTool = {
  name: 'read_resume_jobs',
  kind: 'paid',
  inAppOnly: true,
  action: 'app/you/work/job-actions.ts#readResumeAction',
  runs: 'lib/you/work-history-run.ts#readResumeIntoWorkHistory',
  workspace: 'you',
  definition: {
    name: 'read_resume_jobs',
    description: `Read the jobs off their default résumé in Jobs into the work history on You's Work & school tab. It replaces the rows an earlier read wrote and leaves every job they edited or added. ${QUEUED}`,
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  async prepare(ctx) {
    if (!hasKey()) return NO_KEY;
    const jobs = (await ctx.db('job_search')) as unknown as AppSupabaseClient;
    const { data, error } = await jobs
      .from('resume_versions')
      .select('id, label')
      .eq('user_id', ctx.userId)
      .not('text_content', 'is', null)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) return { ok: false, error: 'Their résumés could not be checked against the database.' };
    if (!data) return { ok: false, error: 'There is no résumé with text in Jobs to read. They add one there first.' };
    const label = String((data as { label: string }).label);
    return {
      ok: true,
      args: {},
      line: `Read the jobs off your résumé ${label} into Work & school.`,
      paths: [EDUCATION_HREF],
    };
  },
  async run(ctx) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return { ok: false, error: 'Reading a résumé needs ANTHROPIC_API_KEY to be set.' };
    const result = await readResumeIntoWorkHistory({
      jobs: (await ctx.db('job_search')) as unknown as AppSupabaseClient,
      you: await youOf(ctx),
      userId: ctx.userId,
      apiKey,
    });
    if (!result.ok) return { ok: false, error: result.error };
    const added = result.added === 1 ? '1 job' : `${result.added} jobs`;
    return {
      ok: true,
      subjectRef: result.firstAddedId
        ? toRef('you.work_history', result.firstAddedId)
        : toRef('job_search.resume_versions', result.resumeId),
      op: result.firstAddedId ? 'insert' : 'update',
      summary: `Dash read your résumé ${result.resume}: added ${added} and kept ${result.kept} you had.`,
    };
  },
};

/** Ask Maya on a note's page (plan #1588). */
const askMayaTool: DashPaidTool = {
  name: 'ask_maya',
  kind: 'paid',
  inAppOnly: true,
  action: 'app/vault/n/[...path]/actions.ts#askMaya',
  runs: 'lib/vault/maya/ask-run.ts#askMayaAbout',
  workspace: 'vault',
  definition: {
    name: 'ask_maya',
    description: `Ask Maya to write her thought on one vault note, opening the note's thread with her, when they ask what Maya makes of a note. A note that already has a thread with Maya is not asked again. ${QUEUED}`,
    input_schema: {
      type: 'object',
      properties: {
        note_path: { type: 'string', description: "The note's path in the vault, such as Journal/2026-10-01.md." },
      },
      required: ['note_path'],
      additionalProperties: false,
    },
  },
  async prepare(ctx, input) {
    const notePath = text(inputOf(input), 'note_path');
    if (!notePath || notePath.length > 1024) return { ok: false, error: 'Name the note by its path in the vault.' };
    if (!hasKey()) return NO_KEY;
    const vault = await vaultOf(ctx);
    const { data: note, error } = await vault
      .from('notes')
      .select('id, path, title')
      .eq('path', notePath)
      .is('deleted_at', null)
      .maybeSingle();
    if (error) return { ok: false, error: 'The note could not be checked against the database.' };
    if (!note) return { ok: false, error: 'That note is not in their vault.' };
    const { id, path, title } = note as { id: string; path: string; title: string | null };
    const core = await coreOf(ctx);
    const { data: thread } = await core
      .from('conversations')
      .select('id')
      .eq('subject_kind', 'row')
      .eq('subject_ref', noteRef(id))
      .eq('voice', 'maya')
      .maybeSingle();
    if (thread) {
      return {
        ok: false,
        error: `Maya has already written on that note; her thread is at ${mayaThreadHref(String((thread as { id: string }).id))}.`,
      };
    }
    const name = title?.trim() || path.replace(/^.*\//, '').replace(/\.md$/i, '');
    return {
      ok: true,
      args: { notePath: path, name },
      line: `Ask Maya about the note ${name}.`,
      paths: [noteHref(path)],
    };
  },
  async run(ctx, args) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return { ok: false, error: 'Asking Maya needs ANTHROPIC_API_KEY to be set.' };
    const outcome = await askMayaAbout({
      db: { core: await coreOf(ctx), vault: await vaultOf(ctx) },
      userId: ctx.userId,
      notePath: String(args.notePath),
      apiKey,
    });
    if (outcome.kind !== 'thread') return { ok: false, error: outcome.detail };
    return {
      ok: true,
      subjectRef: toRef('core.conversations', outcome.threadId),
      op: outcome.existing ? 'update' : 'insert',
      summary: `Maya wrote her thought on ${String(args.name)}, in its thread with her.`,
    };
  },
};

/** Price now on the sell page, for a row or the ticked rows, and Get a price on an item's page (plan #2228.5 stands it for both). */
const priceItemsTool: DashPaidTool = {
  name: 'price_items_for_sale',
  kind: 'paid',
  inAppOnly: true,
  action: 'app/shopping/sell/actions.ts#priceSellItems',
  runs: 'lib/sell/price-items-run.ts#priceItemsFor',
  workspace: 'shopping',
  definition: {
    name: 'price_items_for_sale',
    description: `Look up a fresh resale price for items they own that are marked for sale, as Price now on the sell page does, for up to ${ESTIMATE_BATCH_LIMIT} items at a time. Each item is priced, and costs, on its own. ${QUEUED}`,
    input_schema: {
      type: 'object',
      properties: {
        item_ids: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          maxItems: ESTIMATE_BATCH_LIMIT,
          description: 'The inventory_items ids to price, each one they own and have marked for sale.',
        },
      },
      required: ['item_ids'],
      additionalProperties: false,
    },
  },
  async prepare(ctx, input) {
    const raw = inputOf(input).item_ids;
    const ids = [...new Set(Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string') : [])];
    if (ids.length === 0 || !ids.every(isUuid)) return { ok: false, error: 'Name the items to price by their ids.' };
    if (ids.length > ESTIMATE_BATCH_LIMIT) {
      return { ok: false, error: `Price up to ${ESTIMATE_BATCH_LIMIT} items at a time.` };
    }
    const shop = (await ctx.db('public')) as unknown as SupabaseClient;
    const { data, error } = await shop
      .from('inventory_items')
      .select('id, name')
      .eq('user_id', ctx.userId)
      .eq('status', 'owned')
      .eq('for_sale', true)
      .in('id', ids);
    if (error) return { ok: false, error: 'The items could not be checked against the database.' };
    const found = (data ?? []) as { id: string; name: string }[];
    if (found.length < ids.length) {
      return { ok: false, error: 'Some of those items are not theirs, not owned any more, or not marked for sale.' };
    }
    const line =
      found.length === 1 ? `Look up a resale price for ${found[0].name}.` : `Look up resale prices for ${found.length} items for sale.`;
    return {
      ok: true,
      args: { ids },
      line,
      count: ids.length,
      paths: ['/shopping/sell', ...ids.map((id) => `/shopping/inventory/${id}`)],
    };
  },
  async run(ctx, args) {
    const ids = (args.ids as string[]).filter(isUuid);
    const result = await priceItemsFor({
      supabase: (await ctx.db('public')) as unknown as SupabaseClient,
      userId: ctx.userId,
      ids,
    });
    if (result.source === 'none') return { ok: false, error: 'No price source is set up on this deployment.' };
    if (result.attempted === 0) return { ok: false, error: 'None of those items could be priced.' };
    const none = result.priced === 0 ? ' No price came back: nothing comparable was listed.' : '';
    return {
      ok: true,
      subjectRef: toRef('public.inventory_items', ids[0]),
      op: 'update',
      summary: `Dash priced ${result.priced} of ${result.attempted} items for sale.${none}`,
    };
  },
};

/** Reload on News's recommended newsletters (plan #947). */
const remakeRecommendationsTool: DashPaidTool = {
  name: 'remake_newsletter_picks',
  kind: 'paid',
  inAppOnly: true,
  action: 'app/news/all/actions.ts#remakeRecommendations',
  runs: 'lib/news/recommend/make.ts#makeRecommendations',
  workspace: 'news',
  definition: {
    name: 'remake_newsletter_picks',
    description: `Make the list of recommended newsletters on News again, searching the web for free ones on their topics that they do not already get, in place of the list there now. It takes about a minute. ${QUEUED}`,
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  async prepare() {
    if (!hasKey()) return NO_KEY;
    return { ok: true, args: {}, line: 'Make the list of recommended newsletters again.', paths: ['/news/all'] };
  },
  async run(ctx) {
    const result = await makeRecommendations({
      news: (await ctx.db('news')) as unknown as NewsSupabaseClient,
      spend: await coreOf(ctx),
      userId: ctx.userId,
      anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    });
    if (!result.ok) {
      return {
        ok: false,
        error: result.reason === 'no-key' ? 'This deployment has no ANTHROPIC_API_KEY, so no list can be made.' : result.detail,
      };
    }
    return {
      ok: true,
      subjectRef: toRef('news.recommendations', ctx.userId),
      op: 'update',
      summary: `Dash made the list of recommended newsletters again: ${result.picks.length} picks.`,
    };
  },
};

/** The paid tools in Vault, News, Shopping and You, in the order the model is sent them. */
export const OTHER_PAID_TOOLS: readonly DashPaidTool[] = [
  readPersonalityTool,
  readResumeTool,
  askMayaTool,
  priceItemsTool,
  remakeRecommendationsTool,
];
