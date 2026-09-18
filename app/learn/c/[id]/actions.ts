'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import { fromClaim, MAX_SELECTION, normaliseSelection } from '@/lib/learn/graph/branch';
import { approvedChainSchema, type ProposedChain } from '@/lib/learn/graph/chain-payload';
import { loadConceptView } from '@/lib/learn/graph/concept';
import { generateChain } from '@/lib/learn/graph/generate';
import { isSameClaim, MAX_CLAIM, rewriteClaimPatch } from '@/lib/learn/graph/rewrite';
import { existingConcepts, saveChain } from '@/lib/learn/graph/save';
import { collectSpend, recordLearnSpend } from '@/lib/learn/spend';

/**
 * Going deeper on a phrase inside a claim.
 *
 * Growth trigger 5. The phrase is the goal and the claim it sits in is the
 * context, so this is the generator that already lays out a typed goal, told
 * where the words came from -- not a second, smaller way of adding a node.
 * That is the point: a branch somebody asked for is a small goal, the
 * generator already knows how to place one under what it depends on, and the
 * approval in between is the only thing standing between a highlight and a
 * graph full of claims nobody read.
 *
 * Two steps, the same as every other way into the graph. `proposeBranch`
 * spends and writes nothing; `approveBranch` writes, and only what came back
 * from a proposal somebody looked at.
 */

export type BranchState = {
  error?: string;
  /** Said out loud when the answer is a legitimate nothing. Not an error. */
  message?: string;
  /** Proposed, not saved. */
  chain?: ProposedChain;
  /** The phrase that was selected, kept for the approval that follows. */
  selection?: string;
};

const ProposeInput = z.object({
  conceptId: z.string().uuid(),
  selection: z.string().trim().min(1).max(MAX_SELECTION),
});

// latency: pending
export async function proposeBranch(
  _prev: BranchState,
  formData: FormData,
): Promise<BranchState> {
  const user = await requireUser();

  const parsed = ProposeInput.safeParse({
    conceptId: formData.get('conceptId') ?? '',
    selection: normaliseSelection(String(formData.get('selection') ?? '')),
  });
  if (!parsed.success) return { error: 'Select a phrase in the claim first.' };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { error: 'Going deeper needs ANTHROPIC_API_KEY to be set.' };

  const supabase = await createLearnClient();
  const view = await loadConceptView(supabase, parsed.data.conceptId);
  if (!view) return { error: 'That concept is not there any more.' };

  // The offer is only ever drawn over the claim, so a phrase that is not in it
  // did not come from the page.
  if (!fromClaim(parsed.data.selection, view.concept.claim)) {
    return { error: 'Select a phrase from the claim itself.' };
  }

  const spend = collectSpend();
  const result = await generateChain({
    goal: parsed.data.selection,
    subject: view.subject.name,
    existing: await existingConcepts(supabase, view.subject.id),
    from: { name: view.concept.name, claim: view.concept.claim },
    anthropicApiKey: apiKey,
    onSpend: spend.sink,
  });
  await recordLearnSpend(user.id, 'branch-from-selection', spend.reports);

  if (!result.ok) {
    if (result.reason === 'error') return { error: result.detail };
    return {
      message:
        result.reason === 'too-vague'
          ? 'Too broad to lay out as a chain. Select the specific phrase you do not follow.'
          : result.detail,
    };
  }

  return {
    // Pinned to the subject the concept is in, whatever the model called it.
    // A branch off a claim is depth in the subject you are reading, and a
    // second subject under a near-miss of the same name is the one outcome
    // this must not have.
    chain: { ...result.chain, subject: view.subject.name },
    selection: parsed.data.selection,
  };
}

/**
 * Write the branch they approved.
 *
 * A goal, like any other: the chain reaches something they asked to
 * understand, and `asked` is the phrase they selected. Where it joins the
 * claim it came from is whatever the generation said -- the edge is already in
 * the chain, named on both ends, and re-deciding it here would be guessing
 * against the only thing that read the words.
 */
// latency: pending
export async function approveBranch(
  _prev: BranchState,
  formData: FormData,
): Promise<BranchState> {
  const user = await requireUser();

  const conceptId = z.string().uuid().safeParse(formData.get('conceptId'));
  if (!conceptId.success) return { error: 'Could not work out which concept that was.' };

  const selection = z
    .string()
    .trim()
    .min(1)
    .max(MAX_SELECTION)
    .safeParse(formData.get('selection'));
  if (!selection.success) return { error: 'Could not work out what was selected.' };

  const raw = formData.get('chain');
  if (typeof raw !== 'string') return { error: 'There is nothing here to approve.' };

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return { error: 'That proposal did not survive the trip. Ask again.' };
  }

  const safe = approvedChainSchema.safeParse(payload);
  if (!safe.success) return { error: 'That proposal did not survive the trip. Ask again.' };

  const supabase = await createLearnClient();
  let saved;
  try {
    saved = await saveChain(supabase, user.id, safe.data as ProposedChain, selection.data);
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Could not save that chain.' };
  }

  // Back onto the page they are already on, where the new claims show up as
  // what this one rests on or what rests on it.
  revalidatePath(`/learn/c/${conceptId.data}`);
  revalidatePath(`/learn/s/${saved.subjectId}`);
  return { message: `Added to ${safe.data.subject}.` };
}

/**
 * The claim, in your own sentence.
 *
 * Written in place, because everything that reads a concept reads `claim`:
 * the next question about it is written against whatever is in that column,
 * which is the whole point of being able to change it. The sentence it
 * replaced is kept once -- see `rewriteClaimPatch` for why only once -- and
 * nothing else about the concept moves. In particular the questions already
 * asked keep their answers, which is what #382 settled.
 *
 * The concept is read back first rather than trusted from the page, so the
 * kept copy is decided from what the column actually holds and RLS has said
 * the row is yours before anything is written.
 */
// latency: pending
export async function rewriteClaim({
  conceptId,
  claim,
}: {
  conceptId: string;
  claim: string;
}): Promise<{ error?: string }> {
  await requireUser();

  const parsed = z
    .object({
      conceptId: z.string().uuid(),
      claim: z.string().trim().min(1).max(MAX_CLAIM),
    })
    .safeParse({ conceptId, claim });
  if (!parsed.success) {
    return {
      error:
        claim.trim().length === 0
          ? 'A claim is a sentence somebody can be wrong about. Write one.'
          : `Keep it under ${MAX_CLAIM} characters — a claim is a sentence or two.`,
    };
  }

  const supabase = await createLearnClient();
  const { data, error } = await supabase
    .from('concepts')
    .select('claim, claim_original')
    .eq('id', parsed.data.conceptId)
    .maybeSingle();

  if (error) return { error: `Reading that concept failed: ${error.message}` };
  if (!data) return { error: 'That concept is not there any more.' };

  const current = data as { claim: string; claim_original: string | null };
  if (isSameClaim(current.claim, parsed.data.claim)) return {};

  const { error: writeError } = await supabase
    .from('concepts')
    .update(
      rewriteClaimPatch(
        { claim: current.claim, claimOriginal: current.claim_original },
        parsed.data.claim,
      ),
    )
    .eq('id', parsed.data.conceptId);

  if (writeError) return { error: `Saving your wording failed: ${writeError.message}` };

  revalidatePath(`/learn/c/${parsed.data.conceptId}`);
  return {};
}
