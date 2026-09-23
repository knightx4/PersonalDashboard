import 'server-only';

import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import type { SpendReport } from '@/lib/core/spend/pricing';
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

export {
  PAIRS_PER_CALL,
  parseVerdicts,
  survivorOf,
  type JudgeOutcome,
  type MergeProposalRow,
} from '@/lib/vault/map/merge-pass';

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
 * themes asks nothing and spends nothing. The loop, the parsing and the store
 * are shared with the position pass in merge-pass.ts.
 *
 * Runs from the map sweep's cron tick after the embedding pass, for every
 * account, with spend recorded against the account whose themes were judged.
 */

const TOOL_NAME = 'judge_theme_pairs';
const OPERATION: LearnOperation = 'propose-theme-merges';

/**
 * The candidate floors. Cosine similarity 0.7 was read off the first themes
 * embedded with voyage-4-lite (see the migration); trigram 0.5 catches word
 * order and plural differences in names without pulling in pairs that only
 * share a common word.
 */
export const CANDIDATE_FLOORS = { neighbours: 5, minSimilarity: 0.7, minTrigram: 0.5 } as const;

export type ThemeSide = { id: string; name: string; about: string; notes: number };

export type ThemePair = MergePair<ThemeSide>;

export type ThemeVerdict = MergeVerdict;

export type ThemeMergePorts = MergePassPorts<ThemePair>;
export type ThemeMergeOptions = MergePassOptions;
export type ThemeMergeResult = MergePassResult;

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

For same, give a reason of at most twelve words; it is shown to the person
beside the merge. For different, give no reason. Give a confidence from 0 to 1.`;

/** The user message: the pairs, numbered from 1 as the model sees them. */
export function renderPairs(pairs: ThemePair[]): string {
  const side = (label: string, theme: ThemeSide) =>
    `${label}: "${theme.name}" (${theme.notes} ${theme.notes === 1 ? 'note' : 'notes'}). ${theme.about}`;
  return pairs
    .map((pair, index) => [`Pair ${index + 1}`, side('A', pair.a), side('B', pair.b)].join('\n'))
    .join('\n\n');
}


/** One theme proposal row from a pair and its verdict. */
export function proposalRow(pair: ThemePair, verdict: ThemeVerdict, model: string): MergeProposalRow {
  return mergeProposalRow('theme', pair, verdict, model);
}

/** The shared loop, writing theme proposals. */
export function runThemeMerges(
  ports: ThemeMergePorts,
  options: ThemeMergeOptions = {},
): Promise<ThemeMergeResult> {
  return runMergePass('theme', ports, options);
}

/** One Haiku call over a batch of theme pairs. Never throws. */
export function judgeThemePairs(input: {
  pairs: ThemePair[];
  anthropicApiKey: string;
  onSpend?: (report: SpendReport) => void;
}): Promise<JudgeOutcome> {
  return judgePairs({
    system: SYSTEM,
    toolName: TOOL_NAME,
    nameDescription: 'The merged name, when same.',
    rendered: renderPairs(input.pairs),
    pairCount: input.pairs.length,
    anthropicApiKey: input.anthropicApiKey,
    onSpend: input.onSpend,
  });
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

    store: (rows) => storeProposals(supabase, rows),
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
      ledger: spendLedger(core, OPERATION),
    },
    options,
  );
}
