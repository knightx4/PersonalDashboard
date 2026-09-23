import 'server-only';

import type { VaultSupabaseClient } from '@/lib/vault/db/schema-name';
import type { MergeKind } from '@/lib/vault/map/merge-pass';

/**
 * Carry out a merge of two themes or two positions, and undo one.
 *
 * The work is done by obsidian.merge_themes, obsidian.merge_positions and
 * obsidian.undo_map_merge (supabase/migrations-vault/0009). A merge moves
 * every row that named the absorbed side onto the survivor, deletes the
 * absorbed row and records all of it in obsidian.map_merges; undo reads that
 * record and puts both rows and everything they had back.
 *
 * With the session client the functions refuse another person's rows. The
 * service-role client can merge for any owner, which is how a background run
 * over the proposals (#820) calls it.
 */

export type MergeSummary = {
  mergeId: string;
  kind: MergeKind;
  survivorId: string;
  absorbedId: string;
  proposalId: string | null;
  mergedAt: string;
  undoneAt: string | null;
  /** Rows repointed at the survivor, per table. */
  moved: Record<string, number>;
  /** Rows deleted because the survivor already had the same one, per table. */
  removed: Record<string, number>;
};

export type MergeFailure = {
  ok: false;
  reason:
    | 'gone'
    | 'invalid'
    | 'name-taken'
    | 'proposal-mismatch'
    | 'already-undone'
    | 'survivor-gone'
    | 'error';
  detail: string;
};

export type MergeOutcome = ({ ok: true } & MergeSummary) | MergeFailure;

export type MergeInput = {
  survivorId: string;
  absorbedId: string;
  /** The name the survivor carries afterwards; null keeps its own. */
  name?: string | null;
  /** The proposal being applied, recorded on the merge so the log can show it. */
  proposalId?: string | null;
};

const KNOWN_DETAILS = new Set<MergeFailure['reason']>([
  'invalid',
  'name-taken',
  'proposal-mismatch',
  'already-undone',
  'survivor-gone',
]);

function failure(error: { code?: string; message: string; details?: string | null }): MergeFailure {
  if (error.code === 'P0002') return { ok: false, reason: 'gone', detail: error.message };
  const detail = error.details as MergeFailure['reason'] | undefined;
  if (detail && KNOWN_DETAILS.has(detail))
    return { ok: false, reason: detail, detail: error.message };
  return { ok: false, reason: 'error', detail: error.message };
}

export async function mergeMapRows(
  supabase: VaultSupabaseClient,
  kind: MergeKind,
  input: MergeInput,
): Promise<MergeOutcome> {
  const { data, error } = await supabase.rpc(
    kind === 'theme' ? 'merge_themes' : 'merge_positions',
    {
      p_survivor_id: input.survivorId,
      p_absorbed_id: input.absorbedId,
      p_name: input.name ?? null,
      p_proposal_id: input.proposalId ?? null,
    },
  );
  if (error) return failure(error);
  return { ok: true, ...(data as MergeSummary) };
}

export async function undoMapMerge(
  supabase: VaultSupabaseClient,
  mergeId: string,
): Promise<MergeOutcome> {
  const { data, error } = await supabase.rpc('undo_map_merge', { p_merge_id: mergeId });
  if (error) return failure(error);
  return { ok: true, ...(data as MergeSummary) };
}

/** The fields of a merge proposal that applying it reads. */
export type ApplicableProposal = {
  id: string;
  kind: MergeKind;
  a_id: string;
  b_id: string;
  verdict: 'same' | 'different';
  survivor_id: string | null;
  survivor_name: string | null;
};

/**
 * What applying a proposal merges: the side the model chose survives under
 * the name it gave, and the other side is absorbed. Null for a `different`
 * verdict, which has nothing to apply.
 */
export function mergeInputFromProposal(proposal: ApplicableProposal): MergeInput | null {
  if (proposal.verdict !== 'same' || !proposal.survivor_id) return null;
  const absorbedId = proposal.survivor_id === proposal.a_id ? proposal.b_id : proposal.a_id;
  return {
    survivorId: proposal.survivor_id,
    absorbedId,
    name: proposal.survivor_name,
    proposalId: proposal.id,
  };
}
