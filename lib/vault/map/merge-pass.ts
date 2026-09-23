import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import { usageFrom, type SpendReport } from '@/lib/core/spend/pricing';
import { recordSpend } from '@/lib/core/spend/record';
import { forceTool, toolBlockIn, whyNoReport } from '@/lib/learn/graph/tool-call';
import type { LearnOperation } from '@/lib/learn/spend';
import type { VaultSupabaseClient } from '@/lib/vault/db/schema-name';

/**
 * What the theme merge pass (#811) and the position merge pass (#812) share.
 *
 * Both read unjudged pairs from a candidate function, ask Haiku about twenty
 * at a time whether each pair is one thing, and write every answer to
 * obsidian.map_merge_proposals (supabase/migrations-vault/0007) under their
 * own `kind`. Neither changes a theme or a position. What differs is the
 * candidate function, the prompt and how a pair is shown to the model; the
 * loop, the verdict parsing, the proposal row and the store are here.
 */

export const MERGE_MODEL = 'claude-haiku-4-5';

/** Pairs per model call. The spec's cost model assumes twenty. */
export const PAIRS_PER_CALL = 20;

export type MergeKind = 'theme' | 'position';

/** One side of a pair: what every kind has. */
export type MergeSide = { id: string; name: string; notes: number };

export type MergePair<S extends MergeSide = MergeSide> = {
  userId: string;
  a: S;
  b: S;
  /** Cosine similarity of the embeddings, or null when trigram alone found the pair. */
  similarity: number | null;
  /** Trigram similarity of the names, or null when it was under the floor. */
  trigram: number | null;
};

export type MergeVerdict = {
  /** Index into the pairs sent, from 0. */
  pair: number;
  same: boolean;
  /** The merged name, for a `same` verdict. */
  name: string | null;
  reason: string;
  confidence: number;
};

export type MergeProposalRow = {
  user_id: string;
  kind: MergeKind;
  a_id: string;
  b_id: string;
  a_name: string;
  b_name: string;
  source: 'embedding' | 'trigram' | 'both';
  similarity: number | null;
  trigram: number | null;
  verdict: 'same' | 'different';
  survivor_id: string | null;
  survivor_name: string | null;
  reason: string;
  confidence: number;
  model: string;
};

export type JudgeOutcome =
  | { ok: true; verdicts: MergeVerdict[]; model: string }
  | { ok: false; reason: string; detail: string };

const verdictSchema = z.object({
  pair: z.number().int(),
  same: z.boolean(),
  name: z.string().nullish(),
  reason: z.string().nullish(),
  confidence: z.number(),
});

const replySchema = z.object({ verdicts: z.array(z.unknown()) });

/**
 * The verdicts the model reported, keyed back to the pairs sent.
 *
 * The model numbers pairs from 1. A verdict for a pair that was not sent, a
 * second verdict for one pair, a malformed entry and a `same` with no reason
 * are all dropped, and the pair stays unjudged for the next run to ask again.
 * A `different` carries no reason: nothing shows one, and asking for it was
 * most of what these calls cost.
 */
export function parseVerdicts(input: unknown, pairCount: number): MergeVerdict[] {
  const reply = replySchema.safeParse(input);
  if (!reply.success) return [];

  const seen = new Set<number>();
  const verdicts: MergeVerdict[] = [];
  for (const raw of reply.data.verdicts) {
    const parsed = verdictSchema.safeParse(raw);
    if (!parsed.success) continue;
    const index = parsed.data.pair - 1;
    if (index < 0 || index >= pairCount || seen.has(index)) continue;
    const reason = parsed.data.same ? (parsed.data.reason?.trim() ?? '') : '';
    if (parsed.data.same && reason === '') continue;
    seen.add(index);
    const name = parsed.data.name?.trim() || null;
    verdicts.push({
      pair: index,
      same: parsed.data.same,
      name: parsed.data.same ? name : null,
      reason,
      confidence: Math.min(1, Math.max(0, Number.isFinite(parsed.data.confidence) ? parsed.data.confidence : 0)),
    });
  }
  return verdicts;
}

/**
 * Which side survives a `same` verdict.
 *
 * The side whose name the model chose, when it chose one of the two. When it
 * coined a new name, the side with more notes, so a singleton folds into the
 * larger one; on a tie, side A.
 */
export function survivorOf<S extends MergeSide>(pair: MergePair<S>, name: string | null): S {
  const wanted = name?.trim().toLowerCase();
  if (wanted) {
    if (pair.a.name.trim().toLowerCase() === wanted) return pair.a;
    if (pair.b.name.trim().toLowerCase() === wanted) return pair.b;
  }
  return pair.b.notes > pair.a.notes ? pair.b : pair.a;
}

/** One proposal row from a pair and its verdict. */
export function proposalRow(
  kind: MergeKind,
  pair: MergePair,
  verdict: MergeVerdict,
  model: string,
): MergeProposalRow {
  // The table keeps the smaller id first, so one pair has one row.
  const [first, second] = pair.a.id < pair.b.id ? [pair.a, pair.b] : [pair.b, pair.a];
  const survivor = verdict.same ? survivorOf(pair, verdict.name) : null;
  return {
    user_id: pair.userId,
    kind,
    a_id: first.id,
    b_id: second.id,
    a_name: first.name,
    b_name: second.name,
    source:
      pair.similarity !== null && pair.trigram !== null
        ? 'both'
        : pair.similarity !== null
          ? 'embedding'
          : 'trigram',
    similarity: pair.similarity,
    trigram: pair.trigram,
    verdict: verdict.same ? 'same' : 'different',
    survivor_id: survivor?.id ?? null,
    survivor_name: survivor ? (verdict.name ?? survivor.name) : null,
    reason: verdict.reason,
    confidence: verdict.confidence,
    model,
  };
}

export type MergePassPorts<P extends MergePair> = {
  /** Unjudged pairs, grouped by owner and closest first. */
  candidates(limit: number): Promise<P[]>;
  judge(pairs: P[], onSpend: (report: SpendReport) => void): Promise<JudgeOutcome>;
  /** Write the proposals; returns how many were written. */
  store(rows: MergeProposalRow[]): Promise<number>;
  ledger?(userId: string, report: SpendReport): Promise<void>;
};

export type MergePassOptions = {
  batch?: number;
  /** Epoch milliseconds after which no further call is started. */
  deadline?: number;
  now?: () => number;
};

export type MergePassResult = {
  proposed: number;
  same: number;
  calls: number;
  /** Why it stopped before running out of pairs, or null if it did not. */
  stopped: { reason: string; detail: string } | null;
};

/**
 * The loop, over the ports. It stops on: no pairs left, the deadline, a failed
 * call, and a call that wrote nothing, which is what keeps a pair the model
 * never answers from being sent forever.
 */
export async function runMergePass<P extends MergePair>(
  kind: MergeKind,
  ports: MergePassPorts<P>,
  options: MergePassOptions = {},
): Promise<MergePassResult> {
  const batch = Math.max(1, options.batch ?? PAIRS_PER_CALL);
  const now = options.now ?? Date.now;
  const result: MergePassResult = { proposed: 0, same: 0, calls: 0, stopped: null };

  for (;;) {
    const read = await ports.candidates(batch);
    if (read.length === 0) return result;

    if (options.deadline !== undefined && now() >= options.deadline) {
      result.stopped = { reason: 'time', detail: 'ran out of time with pairs still to judge' };
      return result;
    }

    // One owner per call, so a call never mixes two accounts' rows and its
    // cost has one owner.
    const owner = read[0].userId;
    const pairs = read.filter((pair) => pair.userId === owner);

    const reports: SpendReport[] = [];
    const outcome = await ports.judge(pairs, (report) => reports.push(report));
    result.calls += 1;
    for (const report of reports) await ports.ledger?.(owner, report);

    if (!outcome.ok) {
      result.stopped = { reason: outcome.reason, detail: outcome.detail };
      return result;
    }

    const rows = outcome.verdicts.map((verdict) =>
      proposalRow(kind, pairs[verdict.pair], verdict, outcome.model),
    );
    const written = rows.length === 0 ? 0 : await ports.store(rows);
    result.proposed += written;
    result.same += rows.filter((row) => row.verdict === 'same').length;

    if (written === 0) {
      result.stopped = {
        reason: 'unanswered',
        detail: `the model judged none of ${pairs.length} pairs`,
      };
      return result;
    }
  }
}

/** One Haiku call over a batch of pairs, already rendered. Never throws. */
export async function judgePairs(input: {
  system: string;
  toolName: string;
  /** What `name` means in a `same` verdict, for the tool schema. */
  nameDescription: string;
  rendered: string;
  pairCount: number;
  anthropicApiKey: string;
  client?: Anthropic;
  onSpend?: (report: SpendReport) => void;
}): Promise<JudgeOutcome> {
  const client = input.client ?? new Anthropic({ apiKey: input.anthropicApiKey });
  try {
    const response = await client.messages.create({
      model: MERGE_MODEL,
      // About forty tokens a verdict, with room for a longer reason.
      max_tokens: 200 + input.pairCount * 120,
      system: input.system,
      tools: [
        {
          name: input.toolName,
          description: 'Report a verdict for every pair.',
          input_schema: {
            type: 'object',
            properties: {
              verdicts: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    pair: { type: 'integer', description: 'The pair number, from 1.' },
                    same: { type: 'boolean' },
                    name: { type: 'string', description: input.nameDescription },
                    reason: {
                      type: 'string',
                      description: 'When same: at most twelve words. Omit when different.',
                    },
                    confidence: { type: 'number' },
                  },
                  required: ['pair', 'same', 'confidence'],
                },
              },
            },
            required: ['verdicts'],
          },
        },
      ],
      tool_choice: forceTool(input.toolName),
      messages: [{ role: 'user', content: input.rendered }],
    });

    input.onSpend?.({ model: MERGE_MODEL, usage: usageFrom(response.usage) });

    const block = toolBlockIn(response, input.toolName);
    if (!block || block.type !== 'tool_use') {
      return { ok: false, reason: 'no-report', detail: whyNoReport(response) };
    }
    return { ok: true, verdicts: parseVerdicts(block.input, input.pairCount), model: MERGE_MODEL };
  } catch (error) {
    return {
      ok: false,
      reason: 'failed',
      detail: error instanceof Error ? error.message : 'The call failed.',
    };
  }
}

/**
 * Write proposals, skipping any pair already judged. Returns how many rows
 * were new.
 */
export async function storeProposals(
  supabase: VaultSupabaseClient,
  rows: MergeProposalRow[],
): Promise<number> {
  const { data, error } = await supabase
    .from('map_merge_proposals')
    .upsert(rows, { onConflict: 'user_id,kind,a_id,b_id', ignoreDuplicates: true })
    .select('id');
  if (error) throw new Error(`Writing merge proposals failed: ${error.message}`);
  return (data ?? []).length;
}

/** The spend port: one row per call, against the account whose pairs were judged. */
export function spendLedger(
  core: Pick<CoreSupabaseClient, 'from'> | null,
  operation: LearnOperation,
): MergePassPorts<MergePair>['ledger'] {
  if (!core) return undefined;
  return async (owner, report) => {
    await recordSpend(core, owner, {
      module: 'learn',
      operation,
      model: report.model,
      usage: report.usage,
    });
  };
}
