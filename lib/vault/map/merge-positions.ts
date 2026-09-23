import 'server-only';

import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { NODE_RULE } from '@/lib/learn/graph/position-prompt';
import type { LearnOperation } from '@/lib/learn/spend';
import type { VaultSupabaseClient } from '@/lib/vault/db/schema-name';
import {
  judgePairs,
  proposalRow as mergeProposalRow,
  runMergePass,
  spendLedger,
  storeProposals,
  type JudgeOutcome,
  type MergePair,
  type MergePassOptions,
  type MergePassPorts,
  type MergePassResult,
  type MergeProposalRow,
  type MergeVerdict,
} from '@/lib/vault/map/merge-pass';

/**
 * Proposing which positions are one position stated in two notes (plan #812).
 *
 * Extraction reads one note at a time, so a position the writer comes back to
 * is recorded once per note, in different words each time. This pass finds
 * pairs from different notes, asks Haiku about twenty at a time whether each
 * pair is one position, and writes every answer to
 * obsidian.map_merge_proposals with kind 'position', the table the theme pass
 * (merge-themes.ts) writes to. It changes no position. Applying the `same`
 * verdicts is #820's, through the merge functions from #813, which keep both
 * notes' quotes on the survivor.
 *
 * Candidates come from obsidian.position_merge_candidates
 * (supabase/migrations-vault/0008): name pairs close by trigram, plus each
 * position's nearest neighbours by the embedding of its statement, minus pairs
 * that share a note and pairs already judged. Since 0011 (plan #836) the pairs
 * are kept in obsidian.position_pairs and each call searches only up to 100
 * positions not yet searched as they stand, so a call stays near a second
 * rather than the eleven that PostgREST's eight-second timeout cancelled.
 * Since 0018 (plan #882) the pair a proposal leads to after one of its sides
 * was absorbed, the survivor and the other side, is offered first.
 *
 * The model judges against the node test from position-prompt.ts, so a claim
 * and its qualification, which pass that test separately, stay two positions.
 */

const TOOL_NAME = 'judge_position_pairs';
const OPERATION: LearnOperation = 'propose-position-merges';

/**
 * The candidate floors. Trigram 0.5 over names finds 60 pairs across notes on
 * the first sweep's 3,014 positions. Cosine 0.75 over statements sits above
 * the 0.70 to 0.72 that separate claims on one subject scored among the first
 * 64 positions embedded; see the migration.
 */
export const POSITION_CANDIDATE_FLOORS = {
  neighbours: 5,
  minSimilarity: 0.75,
  minTrigram: 0.5,
} as const;

export type PositionSide = {
  id: string;
  name: string;
  statement: string;
  kind: string;
  notes: number;
};

export type PositionPair = MergePair<PositionSide>;

export type PositionMergePorts = MergePassPorts<PositionPair>;
export type PositionMergeOptions = MergePassOptions;
export type PositionMergeResult = MergePassResult;

export const POSITION_SYSTEM = `You tidy a map of what somebody's personal notes assert.

Each position on the map is one thing the writer can be right or wrong about,
taken from one of their notes, with a short name and a statement. The map was
built one note at a time, so a position the writer returns to appears once per
note, in different words. You are shown pairs of positions from different
notes, and for each pair you say whether the two are one position.

This is what a position is:

${NODE_RULE}

same: the two statements make one assertion. Write the question the node test
asks for, the one that separates somebody who holds A from somebody who does
not. If everybody who holds A answers it the way somebody who holds B would,
and the other way round, they are one position. Two wordings of one claim, such
as "Seeking meaning through extremes fails" and "Searching meaning in extremes
fails", are the same.

different: every other pair, including pairs about one subject. In particular:
- A claim and its condition or qualification. "Neighbourhoods should be
  walkable" and "Neighbourhoods should be walkable where density supports
  transit" are two positions, and merging them loses the condition.
- A general claim and one case of it, or two cases of one pattern. "Teaching
  improves retention" and "Chunking improves retention" are different.
- The same words about different things. "Communism requires small scale" and
  "Democracy requires small scale" are different.
- A claim and its opposite, or a claim and a reason for it.

Sharing words does not make two positions one, and different wording does not
make them two. The kind shown beside each side is a guess made when the note
was read; two sides of different kinds can still be one position.

For same, give the short name the merged position should carry. Usually one of
the two names already fits; coin a new one only when neither does, and keep it
as short as the names you were shown.

For same, give a reason of at most twelve words; it is shown to the person
beside the merge. For different, give no reason. Give a confidence from 0 to 1.`;

/** The user message: the pairs, numbered from 1 as the model sees them. */
export function renderPositionPairs(pairs: PositionPair[]): string {
  const side = (label: string, position: PositionSide) =>
    `${label}: "${position.name}" (${position.kind}). ${position.statement}`;
  return pairs
    .map((pair, index) => [`Pair ${index + 1}`, side('A', pair.a), side('B', pair.b)].join('\n'))
    .join('\n\n');
}

/** One position proposal row from a pair and its verdict. */
export function positionProposalRow(
  pair: PositionPair,
  verdict: MergeVerdict,
  model: string,
): MergeProposalRow {
  return mergeProposalRow('position', pair, verdict, model);
}

/** The shared loop, writing position proposals. */
export function runPositionMerges(
  ports: PositionMergePorts,
  options: PositionMergeOptions = {},
): Promise<PositionMergeResult> {
  return runMergePass('position', ports, options);
}

/** One Haiku call over a batch of position pairs. Never throws. */
export function judgePositionPairs(input: {
  pairs: PositionPair[];
  anthropicApiKey: string;
  onSpend?: (report: SpendReport) => void;
}): Promise<JudgeOutcome> {
  return judgePairs({
    system: POSITION_SYSTEM,
    toolName: TOOL_NAME,
    nameDescription: 'The merged position’s short name, when same.',
    rendered: renderPositionPairs(input.pairs),
    pairCount: input.pairs.length,
    anthropicApiKey: input.anthropicApiKey,
    onSpend: input.onSpend,
  });
}

type CandidateRpcRow = {
  user_id: string;
  a_id: string;
  a_name: string;
  a_statement: string;
  a_kind: string;
  a_notes: number;
  b_id: string;
  b_name: string;
  b_statement: string;
  b_kind: string;
  b_notes: number;
  similarity: number | null;
  trigram: number | null;
};

/** The pair the pass works on, from one row of the candidate function. */
export function positionPairFrom(row: CandidateRpcRow): PositionPair {
  return {
    userId: row.user_id,
    a: {
      id: row.a_id,
      name: row.a_name,
      statement: row.a_statement,
      kind: row.a_kind,
      notes: row.a_notes,
    },
    b: {
      id: row.b_id,
      name: row.b_name,
      statement: row.b_statement,
      kind: row.b_kind,
      notes: row.b_notes,
    },
    similarity: row.similarity,
    trigram: row.trigram,
  };
}

/** The ports over the vault client. `userId` null reads every account's positions. */
export function positionMergeStore(
  supabase: VaultSupabaseClient,
  userId: string | null,
): Pick<PositionMergePorts, 'candidates' | 'store'> {
  return {
    async candidates(limit) {
      const { data, error } = await supabase.rpc('position_merge_candidates', {
        p_limit: limit,
        p_user_id: userId,
        p_neighbours: POSITION_CANDIDATE_FLOORS.neighbours,
        p_min_similarity: POSITION_CANDIDATE_FLOORS.minSimilarity,
        p_min_trigram: POSITION_CANDIDATE_FLOORS.minTrigram,
      });
      if (error) throw new Error(`Reading position merge candidates failed: ${error.message}`);
      return ((data ?? []) as CandidateRpcRow[]).map(positionPairFrom);
    },

    store: (rows) => storeProposals(supabase, rows),
  };
}

/**
 * Judge every unjudged position pair until none are left or the deadline
 * passes.
 *
 * `core` is where spend rows go; null writes none.
 */
export async function proposePositionMerges(
  supabase: VaultSupabaseClient,
  core: Pick<CoreSupabaseClient, 'from'> | null,
  options: PositionMergeOptions & { userId?: string | null; anthropicApiKey: string },
): Promise<PositionMergeResult> {
  return runPositionMerges(
    {
      ...positionMergeStore(supabase, options.userId ?? null),
      judge: (pairs, onSpend) =>
        judgePositionPairs({ pairs, anthropicApiKey: options.anthropicApiKey, onSpend }),
      ledger: spendLedger(core, OPERATION),
    },
    options,
  );
}
