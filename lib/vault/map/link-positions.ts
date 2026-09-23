import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import { usageFrom, type SpendReport } from '@/lib/core/spend/pricing';
import {
  MAP_EDGE_RULE,
  MAP_EDGE_TYPES,
  NODE_RULE,
  type MapEdgeType,
} from '@/lib/learn/graph/position-prompt';
import { forceTool, toolBlockIn, whyNoReport } from '@/lib/learn/graph/tool-call';
import type { LearnOperation } from '@/lib/learn/spend';
import type { VaultSupabaseClient } from '@/lib/vault/db/schema-name';
import { MERGE_MODEL, PAIRS_PER_CALL, spendLedger } from '@/lib/vault/map/merge-pass';

/**
 * Linking positions across notes (plan #816).
 *
 * Extraction proposes edges between positions of one note only, so no edge on
 * the map crossed notes and about one position in five had none. This pass
 * takes pairs of positions from different notes that sit near each other by
 * the embedding of their statements, asks Haiku about twenty at a time which
 * of the six edge types from position-prompt.ts joins each pair, if any, and
 * writes what it finds to obsidian.position_edges.
 *
 * Candidates come from obsidian.position_link_candidates
 * (supabase/migrations-vault/0014): each position's five nearest positions in
 * other notes at cosine 0.65 or above, kept in obsidian.position_link_pairs,
 * with pairs that have an unlinked side first. Every answer is recorded on the
 * pair, `none` included, through obsidian.record_position_links, which writes
 * the edges in the same statement, so a pair is paid for once.
 *
 * The map sweep runs this after the position merge pass has no pairs left
 * (inngest/vault/map-sweep.ts), so it links positions as merged rather than
 * linking two rows that are about to become one.
 */

const TOOL_NAME = 'link_position_pairs';
const OPERATION: LearnOperation = 'link-positions';

/**
 * The candidate floors. Two claims about one subject from different notes
 * score 0.60 to 0.80; at 0.65 and five neighbours the live map of 5,062
 * embedded positions gave 13,267 pairs.
 */
export const LINK_CANDIDATE_FLOORS = {
  neighbours: 5,
  minSimilarity: 0.65,
} as const;

export type LinkSide = { id: string; name: string; statement: string; kind: string };

export type LinkPair = {
  userId: string;
  a: LinkSide;
  b: LinkSide;
  similarity: number;
};

export type LinkRelation = MapEdgeType | 'none';

export type LinkVerdict = {
  /** Index into the pairs sent, from 0. */
  pair: number;
  relation: LinkRelation;
  /** Which side the edge runs from; null for `none`. */
  from: 'A' | 'B' | null;
  reason: string;
  confidence: number;
};

/** One row for obsidian.record_position_links. */
export type LinkRecordRow = {
  a_id: string;
  b_id: string;
  relation: LinkRelation;
  from_id: string | null;
  reason: string;
  confidence: number;
  model: string;
};

export type LinkJudgeOutcome =
  | { ok: true; verdicts: LinkVerdict[]; model: string }
  | { ok: false; reason: string; detail: string };

export type LinkPassPorts = {
  /** Unjudged pairs, grouped by owner, unlinked sides first. */
  candidates(limit: number): Promise<LinkPair[]>;
  judge(pairs: LinkPair[], onSpend: (report: SpendReport) => void): Promise<LinkJudgeOutcome>;
  /** Record the judgements; returns pairs recorded and edges written. */
  record(rows: LinkRecordRow[]): Promise<{ recorded: number; edges: number }>;
  ledger?(userId: string, report: SpendReport): Promise<void>;
};

export type LinkPassOptions = {
  batch?: number;
  /** Epoch milliseconds after which no further call is started. */
  deadline?: number;
  now?: () => number;
};

export type LinkPassResult = {
  judged: number;
  edges: number;
  calls: number;
  /** Why it stopped before running out of pairs, or null if it did not. */
  stopped: { reason: string; detail: string } | null;
};

export const LINK_SYSTEM = `You connect a map of what somebody's personal notes assert.

Each position on the map is one thing the writer can be right or wrong about,
taken from one of their notes, with a short name and a statement. The map was
built one note at a time, so it knows how the positions inside a note relate
but not how notes answer each other. You are shown pairs of positions from
different notes, and for each pair you say which relation joins them, if any.

This is what a position is:

${NODE_RULE}

${MAP_EDGE_RULE}

Here the two positions come from different notes, so the connection is one a
careful reader of both notes would see, not one either note states. Say "none"
when the two only share a subject: two claims about cities that neither
supports, bounds nor cuts against the other are not related. Say "contradicts"
only when holding both would be inconsistent, not when they merely differ in
emphasis.

For every relation but none, say which side the edge runs from, reading the
definitions above with that side as A. "from": "B" with "supports" means B is
part of why A is true.

Give one short line for every pair saying what the relation actually is, or
why there is none; for an edge it is shown on the map as the edge's
description. Give a confidence from 0 to 1.`;

/** The user message: the pairs, numbered from 1 as the model sees them. */
export function renderLinkPairs(pairs: LinkPair[]): string {
  const side = (label: string, position: LinkSide) =>
    `${label}: "${position.name}" (${position.kind}). ${position.statement}`;
  return pairs
    .map((pair, index) => [`Pair ${index + 1}`, side('A', pair.a), side('B', pair.b)].join('\n'))
    .join('\n\n');
}

const RELATIONS = [...MAP_EDGE_TYPES, 'none'] as const;

const verdictSchema = z.object({
  pair: z.number().int(),
  relation: z.enum(RELATIONS),
  from: z.enum(['A', 'B']).nullish(),
  reason: z.string(),
  confidence: z.number(),
});

const replySchema = z.object({ verdicts: z.array(z.unknown()) });

/**
 * The verdicts the model reported, keyed back to the pairs sent.
 *
 * The model numbers pairs from 1. A verdict for a pair that was not sent, a
 * second verdict for one pair, an unknown relation, an edge with no direction
 * and one with no reason are all dropped, and the pair stays unjudged for a
 * later call.
 */
export function parseLinkVerdicts(input: unknown, pairCount: number): LinkVerdict[] {
  const reply = replySchema.safeParse(input);
  if (!reply.success) return [];

  const seen = new Set<number>();
  const verdicts: LinkVerdict[] = [];
  for (const raw of reply.data.verdicts) {
    const parsed = verdictSchema.safeParse(raw);
    if (!parsed.success) continue;
    const index = parsed.data.pair - 1;
    if (index < 0 || index >= pairCount || seen.has(index)) continue;
    const reason = parsed.data.reason.trim();
    if (reason === '') continue;
    const relation = parsed.data.relation;
    const from = relation === 'none' ? null : (parsed.data.from ?? null);
    if (relation !== 'none' && from === null) continue;
    seen.add(index);
    verdicts.push({
      pair: index,
      relation,
      from,
      reason,
      confidence: Math.min(
        1,
        Math.max(0, Number.isFinite(parsed.data.confidence) ? parsed.data.confidence : 0),
      ),
    });
  }
  return verdicts;
}

/** The row recorded for a pair and its verdict. */
export function linkRecordRow(pair: LinkPair, verdict: LinkVerdict, model: string): LinkRecordRow {
  // The table keeps the smaller id first; the direction is kept by id.
  const [first, second] = pair.a.id < pair.b.id ? [pair.a, pair.b] : [pair.b, pair.a];
  const fromSide = verdict.from === 'A' ? pair.a : verdict.from === 'B' ? pair.b : null;
  return {
    a_id: first.id,
    b_id: second.id,
    relation: verdict.relation,
    from_id: fromSide?.id ?? null,
    reason: verdict.reason,
    confidence: verdict.confidence,
    model,
  };
}

/**
 * The loop, over the ports. It stops on: no pairs left, the deadline, a failed
 * call, and a call that recorded nothing, which keeps a pair the model never
 * answers from being sent forever.
 */
export async function runLinkPass(
  ports: LinkPassPorts,
  options: LinkPassOptions = {},
): Promise<LinkPassResult> {
  const batch = Math.max(1, options.batch ?? PAIRS_PER_CALL);
  const now = options.now ?? Date.now;
  const result: LinkPassResult = { judged: 0, edges: 0, calls: 0, stopped: null };

  for (;;) {
    if (options.deadline !== undefined && now() >= options.deadline) {
      result.stopped = { reason: 'time', detail: 'ran out of time before reading pairs' };
      return result;
    }

    const read = await ports.candidates(batch);
    if (read.length === 0) return result;

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
      linkRecordRow(pairs[verdict.pair], verdict, outcome.model),
    );
    const written = rows.length === 0 ? { recorded: 0, edges: 0 } : await ports.record(rows);
    result.judged += written.recorded;
    result.edges += written.edges;

    if (written.recorded === 0) {
      result.stopped = {
        reason: 'unanswered',
        detail: `the model judged none of ${pairs.length} pairs`,
      };
      return result;
    }
  }
}

/** One Haiku call over a batch of pairs. Never throws. */
export async function judgeLinkPairs(input: {
  pairs: LinkPair[];
  anthropicApiKey: string;
  client?: Anthropic;
  onSpend?: (report: SpendReport) => void;
}): Promise<LinkJudgeOutcome> {
  const client = input.client ?? new Anthropic({ apiKey: input.anthropicApiKey });
  try {
    const response = await client.messages.create({
      model: MERGE_MODEL,
      // About sixty tokens a verdict, with room for a longer line.
      max_tokens: 200 + input.pairs.length * 120,
      system: LINK_SYSTEM,
      tools: [
        {
          name: TOOL_NAME,
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
                    relation: { type: 'string', enum: [...RELATIONS] },
                    from: {
                      type: 'string',
                      enum: ['A', 'B'],
                      description: 'The side the edge runs from. Omit for none.',
                    },
                    reason: { type: 'string' },
                    confidence: { type: 'number' },
                  },
                  required: ['pair', 'relation', 'reason', 'confidence'],
                },
              },
            },
            required: ['verdicts'],
          },
        },
      ],
      tool_choice: forceTool(TOOL_NAME),
      messages: [{ role: 'user', content: renderLinkPairs(input.pairs) }],
    });

    input.onSpend?.({ model: MERGE_MODEL, usage: usageFrom(response.usage) });

    const block = toolBlockIn(response, TOOL_NAME);
    if (!block || block.type !== 'tool_use') {
      return { ok: false, reason: 'no-report', detail: whyNoReport(response) };
    }
    return {
      ok: true,
      verdicts: parseLinkVerdicts(block.input, input.pairs.length),
      model: MERGE_MODEL,
    };
  } catch (error) {
    return {
      ok: false,
      reason: 'failed',
      detail: error instanceof Error ? error.message : 'The call failed.',
    };
  }
}

type CandidateRpcRow = {
  user_id: string;
  a_id: string;
  a_name: string;
  a_statement: string;
  a_kind: string;
  b_id: string;
  b_name: string;
  b_statement: string;
  b_kind: string;
  similarity: number;
};

/** The pair the pass works on, from one row of the candidate function. */
export function linkPairFrom(row: CandidateRpcRow): LinkPair {
  return {
    userId: row.user_id,
    a: { id: row.a_id, name: row.a_name, statement: row.a_statement, kind: row.a_kind },
    b: { id: row.b_id, name: row.b_name, statement: row.b_statement, kind: row.b_kind },
    similarity: row.similarity,
  };
}

/** The ports over the vault client. `userId` null reads every account's positions. */
export function linkStore(
  supabase: VaultSupabaseClient,
  userId: string | null,
): Pick<LinkPassPorts, 'candidates' | 'record'> {
  return {
    async candidates(limit) {
      const { data, error } = await supabase.rpc('position_link_candidates', {
        p_limit: limit,
        p_user_id: userId,
        p_neighbours: LINK_CANDIDATE_FLOORS.neighbours,
        p_min_similarity: LINK_CANDIDATE_FLOORS.minSimilarity,
      });
      if (error) throw new Error(`Reading position link candidates failed: ${error.message}`);
      return ((data ?? []) as CandidateRpcRow[]).map(linkPairFrom);
    },

    async record(rows) {
      const { data, error } = await supabase.rpc('record_position_links', { p_rows: rows });
      if (error) throw new Error(`Recording position links failed: ${error.message}`);
      const row = ((data ?? []) as { recorded: number; edges: number }[])[0];
      return { recorded: row?.recorded ?? 0, edges: row?.edges ?? 0 };
    },
  };
}

/**
 * Judge unjudged link pairs until none are left or the deadline passes.
 *
 * `core` is where spend rows go; null writes none.
 */
export async function linkPositions(
  supabase: VaultSupabaseClient,
  core: Pick<CoreSupabaseClient, 'from'> | null,
  options: LinkPassOptions & { userId?: string | null; anthropicApiKey: string },
): Promise<LinkPassResult> {
  return runLinkPass(
    {
      ...linkStore(supabase, options.userId ?? null),
      judge: (pairs, onSpend) =>
        judgeLinkPairs({ pairs, anthropicApiKey: options.anthropicApiKey, onSpend }),
      ledger: spendLedger(core, OPERATION),
    },
    options,
  );
}
