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
 * Proposing which themes are one subject under two names (plan #811).
 *
 * The map was built one note at a time, so the same subject turns up under
 * several names and most themes cover one note. This pass finds candidate
 * pairs, asks Haiku about twenty at a time whether each pair is one subject,
 * and writes every answer to obsidian.map_merge_proposals
 * (supabase/migrations-vault/0007). It changes no theme. Applying the `same`
 * verdicts is #820's, through the merge functions from #813.
 *
 * Candidates come from obsidian.theme_merge_candidates: each theme's nearest
 * neighbours by embedding, plus name pairs close by trigram, minus every pair
 * already judged. A pair is judged once, so a run over a map with no new
 * themes asks nothing and spends nothing.
 *
 * Runs from the map sweep's cron tick after the embedding pass, for every
 * account, with spend recorded against the account whose themes were judged.
 */

const MODEL = 'claude-haiku-4-5';
const TOOL_NAME = 'judge_theme_pairs';
const OPERATION: LearnOperation = 'propose-theme-merges';

/** Pairs per model call. The spec's cost model assumes twenty. */
export const PAIRS_PER_CALL = 20;

/**
 * The candidate floors. Cosine similarity 0.7 was read off the first themes
 * embedded with voyage-4-lite (see the migration); trigram 0.5 catches word
 * order and plural differences in names without pulling in pairs that only
 * share a common word.
 */
export const CANDIDATE_FLOORS = { neighbours: 5, minSimilarity: 0.7, minTrigram: 0.5 } as const;

export type ThemeSide = { id: string; name: string; about: string; notes: number };

export type ThemePair = {
  userId: string;
  a: ThemeSide;
  b: ThemeSide;
  /** Cosine similarity of the embeddings, or null when trigram alone found the pair. */
  similarity: number | null;
  /** Trigram similarity of the names, or null when it was under the floor. */
  trigram: number | null;
};

export type ThemeVerdict = {
  /** Index into the pairs sent, from 0. */
  pair: number;
  same: boolean;
  /** The merged theme's name, for a `same` verdict. */
  name: string | null;
  reason: string;
  confidence: number;
};

export type MergeProposalRow = {
  user_id: string;
  kind: 'theme';
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
  | { ok: true; verdicts: ThemeVerdict[]; model: string }
  | { ok: false; reason: string; detail: string };

export const SYSTEM = `You tidy a map of the subjects somebody's personal notes are about.

Each theme on the map is a subject their notes return to, with a short name and
one line on what it covers. The map was built one note at a time, so the same
subject often appears under two names. You are shown pairs of themes, and for
each pair you say whether the two are one subject.

same: somebody listing what they write about would put both under one heading.
Two wordings of one subject, such as "Housing affordability crisis" and
"Housing supply and affordability". Or a narrow theme that is one facet of a
broader theme that is still a specific subject, such as "15-minute cities" and
"Urban design and travel patterns".

different: related subjects that each deserve their own place on the list. Two
branches of one field, such as "Monetary policy" and "Fiscal policy". And any
pair where the only heading that covers both is a whole discipline, such as
"Economics" or "Psychology": merging those makes the map less useful.

Sharing words does not make two themes one subject, and different wording does
not make them two.

For same, give the name the merged theme should carry. Usually that is
whichever of the two names already covers both. Coin a new name only when
neither does, and keep it as short as the names you were shown.

Give one short sentence of reason for every pair; it is shown to the person.
Give a confidence from 0 to 1.`;

/** The user message: the pairs, numbered from 1 as the model sees them. */
export function renderPairs(pairs: ThemePair[]): string {
  const side = (label: string, theme: ThemeSide) =>
    `${label}: "${theme.name}" (${theme.notes} ${theme.notes === 1 ? 'note' : 'notes'}). ${theme.about}`;
  return pairs
    .map((pair, index) => [`Pair ${index + 1}`, side('A', pair.a), side('B', pair.b)].join('\n'))
    .join('\n\n');
}

const verdictSchema = z.object({
  pair: z.number().int(),
  same: z.boolean(),
  name: z.string().nullish(),
  reason: z.string(),
  confidence: z.number(),
});

const replySchema = z.object({ verdicts: z.array(z.unknown()) });

/**
 * The verdicts the model reported, keyed back to the pairs sent.
 *
 * The model numbers pairs from 1. A verdict for a pair that was not sent, a
 * second verdict for one pair, a malformed entry and one with no reason are
 * all dropped, and the pair stays unjudged for the next run to ask again.
 */
export function parseVerdicts(input: unknown, pairCount: number): ThemeVerdict[] {
  const reply = replySchema.safeParse(input);
  if (!reply.success) return [];

  const seen = new Set<number>();
  const verdicts: ThemeVerdict[] = [];
  for (const raw of reply.data.verdicts) {
    const parsed = verdictSchema.safeParse(raw);
    if (!parsed.success) continue;
    const index = parsed.data.pair - 1;
    if (index < 0 || index >= pairCount || seen.has(index)) continue;
    const reason = parsed.data.reason.trim();
    if (reason === '') continue;
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
 * larger theme; on a tie, side A.
 */
export function survivorOf(pair: ThemePair, name: string | null): ThemeSide {
  const wanted = name?.trim().toLowerCase();
  if (wanted) {
    if (pair.a.name.trim().toLowerCase() === wanted) return pair.a;
    if (pair.b.name.trim().toLowerCase() === wanted) return pair.b;
  }
  return pair.b.notes > pair.a.notes ? pair.b : pair.a;
}

/** One proposal row from a pair and its verdict. */
export function proposalRow(pair: ThemePair, verdict: ThemeVerdict, model: string): MergeProposalRow {
  // The table keeps the smaller id first, so one pair has one row.
  const [first, second] = pair.a.id < pair.b.id ? [pair.a, pair.b] : [pair.b, pair.a];
  const survivor = verdict.same ? survivorOf(pair, verdict.name) : null;
  return {
    user_id: pair.userId,
    kind: 'theme',
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

export type ThemeMergePorts = {
  /** Unjudged pairs, grouped by owner and closest first. */
  candidates(limit: number): Promise<ThemePair[]>;
  judge(pairs: ThemePair[], onSpend: (report: SpendReport) => void): Promise<JudgeOutcome>;
  /** Write the proposals; returns how many were written. */
  store(rows: MergeProposalRow[]): Promise<number>;
  ledger?(userId: string, report: SpendReport): Promise<void>;
};

export type ThemeMergeOptions = {
  batch?: number;
  /** Epoch milliseconds after which no further call is started. */
  deadline?: number;
  now?: () => number;
};

export type ThemeMergeResult = {
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
export async function runThemeMerges(
  ports: ThemeMergePorts,
  options: ThemeMergeOptions = {},
): Promise<ThemeMergeResult> {
  const batch = Math.max(1, options.batch ?? PAIRS_PER_CALL);
  const now = options.now ?? Date.now;
  const result: ThemeMergeResult = { proposed: 0, same: 0, calls: 0, stopped: null };

  for (;;) {
    const read = await ports.candidates(batch);
    if (read.length === 0) return result;

    if (options.deadline !== undefined && now() >= options.deadline) {
      result.stopped = { reason: 'time', detail: 'ran out of time with pairs still to judge' };
      return result;
    }

    // One owner per call, so a call never mixes two accounts' themes and its
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
      proposalRow(pairs[verdict.pair], verdict, outcome.model),
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

/** One Haiku call over a batch of pairs. Never throws. */
export async function judgeThemePairs(input: {
  pairs: ThemePair[];
  anthropicApiKey: string;
  client?: Anthropic;
  onSpend?: (report: SpendReport) => void;
}): Promise<JudgeOutcome> {
  const client = input.client ?? new Anthropic({ apiKey: input.anthropicApiKey });
  try {
    const response = await client.messages.create({
      model: MODEL,
      // About sixty tokens a verdict, with room for a longer reason.
      max_tokens: 200 + input.pairs.length * 120,
      system: SYSTEM,
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
                    same: { type: 'boolean' },
                    name: { type: 'string', description: 'The merged name, when same.' },
                    reason: { type: 'string' },
                    confidence: { type: 'number' },
                  },
                  required: ['pair', 'same', 'reason', 'confidence'],
                },
              },
            },
            required: ['verdicts'],
          },
        },
      ],
      tool_choice: forceTool(TOOL_NAME),
      messages: [{ role: 'user', content: renderPairs(input.pairs) }],
    });

    input.onSpend?.({ model: MODEL, usage: usageFrom(response.usage) });

    const block = toolBlockIn(response, TOOL_NAME);
    if (!block || block.type !== 'tool_use') {
      return { ok: false, reason: 'no-report', detail: whyNoReport(response) };
    }
    return { ok: true, verdicts: parseVerdicts(block.input, input.pairs.length), model: MODEL };
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
  a_about: string;
  a_notes: number;
  b_id: string;
  b_name: string;
  b_about: string;
  b_notes: number;
  similarity: number | null;
  trigram: number | null;
};

/** The ports over the vault client. `userId` null reads every account's themes. */
export function themeMergeStore(
  supabase: VaultSupabaseClient,
  userId: string | null,
): Pick<ThemeMergePorts, 'candidates' | 'store'> {
  return {
    async candidates(limit) {
      const { data, error } = await supabase.rpc('theme_merge_candidates', {
        p_limit: limit,
        p_user_id: userId,
        p_neighbours: CANDIDATE_FLOORS.neighbours,
        p_min_similarity: CANDIDATE_FLOORS.minSimilarity,
        p_min_trigram: CANDIDATE_FLOORS.minTrigram,
      });
      if (error) throw new Error(`Reading theme merge candidates failed: ${error.message}`);
      return ((data ?? []) as CandidateRpcRow[]).map((row) => ({
        userId: row.user_id,
        a: { id: row.a_id, name: row.a_name, about: row.a_about, notes: row.a_notes },
        b: { id: row.b_id, name: row.b_name, about: row.b_about, notes: row.b_notes },
        similarity: row.similarity,
        trigram: row.trigram,
      }));
    },

    async store(rows) {
      const { data, error } = await supabase
        .from('map_merge_proposals')
        .upsert(rows, { onConflict: 'user_id,kind,a_id,b_id', ignoreDuplicates: true })
        .select('id');
      if (error) throw new Error(`Writing theme merge proposals failed: ${error.message}`);
      return (data ?? []).length;
    },
  };
}

/**
 * Judge every unjudged theme pair until none are left or the deadline passes.
 *
 * `core` is where spend rows go; null writes none.
 */
export async function proposeThemeMerges(
  supabase: VaultSupabaseClient,
  core: Pick<CoreSupabaseClient, 'from'> | null,
  options: ThemeMergeOptions & { userId?: string | null; anthropicApiKey: string },
): Promise<ThemeMergeResult> {
  return runThemeMerges(
    {
      ...themeMergeStore(supabase, options.userId ?? null),
      judge: (pairs, onSpend) =>
        judgeThemePairs({ pairs, anthropicApiKey: options.anthropicApiKey, onSpend }),
      ledger: core
        ? async (owner, report) => {
            await recordSpend(core, owner, {
              module: 'learn',
              operation: OPERATION,
              model: report.model,
              usage: report.usage,
            });
          }
        : undefined,
    },
    options,
  );
}
