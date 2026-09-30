/**
 * Searches that needed more time than a request allows, finished as Message
 * Batches (job_search 0041).
 *
 * A live search runs inside a five-minute request. When its time runs out,
 * model.ts hands back the exact request it was about to make, and
 * `queueSearch` sends it as a one-request batch: the Batches API has no time
 * limit (most finish within the hour, all within a day) and bills at half
 * price. The run waits in stage 'queued' with the batch id and the request.
 *
 * `collectSearchBatches` is called every ten minutes by pg_cron through
 * /api/cron/job-search-batches. For each queued run whose batch has ended it
 * reads the response with the same `searchStep` a live search uses: a report
 * is parsed and stored exactly as on the press; a response without one gets
 * the forced-report follow-up as a second batch, once; a refusal, an error
 * or an expiry closes the run as failed, saying which.
 *
 * Spend is recorded at the model's full rate, which overstates a batch by
 * half: the ledger has no batch price yet.
 */
import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { usageFrom, type SpendReport } from '@/lib/core/spend/pricing';
import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import type { SuggestionKind } from './cadence';
import { OPENINGS_TOOL, PEOPLE_TOOL, SUGGEST_MODEL, searchStep, type SearchRequest } from './model';
import { parseOpeningsPayload, parsePeoplePayload } from './payload';
import { QUEUED_STOPPED_AFTER_HOURS } from './search-runs';
import { openingsTaken, peopleTaken, storeOpenings, storePeople, type BoardOrigin } from './store';

/** Send a timed-out search as a batch. The custom id is the run's id, so the result finds its run. */
export async function queueSearch(apiKey: string, runId: string, request: SearchRequest): Promise<string> {
  const client = new Anthropic({ apiKey });
  const batch = await client.messages.batches.create({ requests: [{ custom_id: runId, params: request }] });
  return batch.id;
}

export type CollectedRun = {
  runId: string;
  userId: string;
  kind: SuggestionKind;
  state: 'pending' | 'done' | 'follow_up' | 'failed';
  written: number;
  headlines: string[];
  spend: SpendReport[];
};

type QueuedRow = {
  id: string;
  user_id: string;
  kind: SuggestionKind;
  started_at: string;
  batch_id: string | null;
  request: SearchRequest | null;
  board_urls: BoardOrigin[] | null;
  follow_ups: number;
};

/**
 * Check every queued run. Every read and write names the run's person, so the
 * service client's missing RLS changes nothing. One run's failure is logged
 * and the rest go on. Stops starting new runs past `deadline`.
 */
export async function collectSearchBatches(
  supabase: AppSupabaseClient,
  apiKey: string,
  options: { deadline: number; now?: Date },
): Promise<CollectedRun[]> {
  const now = options.now ?? new Date();
  const { data, error } = await supabase
    .from('search_runs')
    .select('id, user_id, kind, started_at, batch_id, request, board_urls, follow_ups')
    .eq('stage', 'queued')
    .order('started_at', { ascending: true })
    .limit(20);
  if (error) throw new Error(`Reading the queued searches failed: ${error.message}`);

  const client = new Anthropic({ apiKey });
  const out: CollectedRun[] = [];
  for (const row of (data ?? []) as QueuedRow[]) {
    if (Date.now() > options.deadline) break;
    try {
      out.push(await collectOne(supabase, client, apiKey, row, now));
    } catch (err) {
      console.error('[jobs suggestions] batch collect', err instanceof Error ? err.message : err);
    }
  }
  return out;
}

async function finish(
  supabase: AppSupabaseClient,
  row: QueuedRow,
  outcome: { written: number; error: string | null },
): Promise<void> {
  const { error } = await supabase
    .from('search_runs')
    .update({
      stage: outcome.error ? 'failed' : 'done',
      finished_at: new Date().toISOString(),
      written: outcome.written,
      error: outcome.error,
    })
    .eq('id', row.id)
    .eq('user_id', row.user_id);
  if (error) console.error('[jobs suggestions] batch finish', error.message);
}

async function collectOne(
  supabase: AppSupabaseClient,
  client: Anthropic,
  apiKey: string,
  row: QueuedRow,
  now: Date,
): Promise<CollectedRun> {
  const base = { runId: row.id, userId: row.user_id, kind: row.kind, written: 0, headlines: [], spend: [] };
  const fail = async (message: string): Promise<CollectedRun> => {
    await finish(supabase, row, { written: 0, error: message });
    return { ...base, state: 'failed' };
  };
  if (!row.batch_id || !row.request) return fail('The background search lost its request.');

  const batch = await client.messages.batches.retrieve(row.batch_id);
  if (batch.processing_status !== 'ended') {
    const age = now.getTime() - new Date(row.started_at).getTime();
    if (age > QUEUED_STOPPED_AFTER_HOURS * 3_600_000) return fail('The background search did not finish within a day.');
    return { ...base, state: 'pending' };
  }

  let result: Anthropic.Messages.MessageBatchResult | null = null;
  for await (const entry of await client.messages.batches.results(row.batch_id)) {
    if (entry.custom_id === row.id) result = entry.result;
  }
  if (!result) return fail('The background search came back empty.');
  if (result.type !== 'succeeded') return fail(`The background search ${result.type === 'expired' ? 'expired' : 'failed'}.`);

  const message = result.message;
  const spend: SpendReport[] = [{ model: SUGGEST_MODEL, usage: usageFrom(message.usage) }];

  if (row.kind === 'apply') {
    const taken = await openingsTaken(supabase, row.user_id);
    const step = searchStep(row.request, message, OPENINGS_TOOL, (raw) =>
      parseOpeningsPayload(raw, taken, taken.excludedIndustries),
    );
    if (step.kind === 'report') {
      const stored = await storeOpenings(supabase, row.user_id, step.suggestions, row.board_urls ?? []);
      await finish(supabase, row, { written: stored.length, error: null });
      return { ...base, state: 'done', written: stored.length, headlines: stored, spend };
    }
    return followUp(supabase, apiKey, row, step, spend, fail);
  }

  const taken = await peopleTaken(supabase, row.user_id);
  const step = searchStep(row.request, message, PEOPLE_TOOL, (raw) =>
    parsePeoplePayload(raw, { people: taken.people }, taken.excludedIndustries),
  );
  if (step.kind === 'report') {
    const stored = await storePeople(supabase, row.user_id, step.suggestions);
    await finish(supabase, row, { written: stored.length, error: null });
    return { ...base, state: 'done', written: stored.length, headlines: stored, spend };
  }
  return followUp(supabase, apiKey, row, step, spend, fail);
}

/** A response without a report: send the forced-report request as a second batch, once. */
async function followUp(
  supabase: AppSupabaseClient,
  apiKey: string,
  row: QueuedRow,
  step: { kind: 'refused' } | { kind: 'next'; next: SearchRequest },
  spend: SpendReport[],
  fail: (message: string) => Promise<CollectedRun>,
): Promise<CollectedRun> {
  if (step.kind === 'refused') return { ...(await fail('The search ran but reported nothing.')), spend };
  if (row.follow_ups >= 1) return { ...(await fail('The search ran but reported nothing.')), spend };
  const batchId = await queueSearch(apiKey, row.id, step.next);
  const { error } = await supabase
    .from('search_runs')
    .update({ batch_id: batchId, request: step.next, follow_ups: row.follow_ups + 1 })
    .eq('id', row.id)
    .eq('user_id', row.user_id);
  if (error) console.error('[jobs suggestions] batch follow-up', error.message);
  return { runId: row.id, userId: row.user_id, kind: row.kind, state: 'follow_up', written: 0, headlines: [], spend };
}
