'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import { generateChain } from '@/lib/learn/graph/generate';
import { existingConcepts, saveChain } from '@/lib/learn/graph/save';
import { loadSubject } from '@/lib/learn/graph/load';
import { collectSpend, recordLearnSpend } from '@/lib/learn/spend';
import {
  proposedConceptSchema,
  proposedEdgeSchema,
  type ProposedChain,
} from '@/lib/learn/graph/chain-payload';

/**
 * Naming a goal, and deciding what to do with what comes back.
 *
 * Two steps and a person between them. `proposeGoal` calls the model and
 * writes nothing; `approveChain` writes what came back, and only after
 * somebody has read it.
 *
 * That gap is the cheapest check available on a generated graph and the only
 * one there is before anything gets taught. A wrong reading list is a few
 * unticked rows; a wrong graph is what every later question is asked against.
 */

export type ProposeState = {
  error?: string;
  /** Proposed, not saved. Nothing reaches the graph until you approve it. */
  chain?: ProposedChain;
  /** The words that were typed, kept for the approval that follows. */
  asked?: string;
};

export type ApproveState = { error?: string };

const ProposeInput = z.object({
  goal: z
    .string()
    .trim()
    .min(1, 'Say what you want to understand.')
    .max(300, 'Shorter is better here — the narrower the goal, the better this works.'),
  subjectId: z.string().uuid().nullable(),
});

export async function proposeGoal(
  _prev: ProposeState,
  formData: FormData,
): Promise<ProposeState> {
  const user = await requireUser();

  const raw = formData.get('subjectId');
  const parsed = ProposeInput.safeParse({
    goal: formData.get('goal') ?? '',
    subjectId: typeof raw === 'string' && raw.length > 0 ? raw : null,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Could not read that goal.' };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { error: 'Laying out a goal needs ANTHROPIC_API_KEY to be set.' };

  const supabase = await createLearnClient();

  // Inside a subject, the generator is told what that subject already holds so
  // it does not propose it again. Outside one, it names the subject itself and
  // there is nothing yet to dedupe against.
  const subject = parsed.data.subjectId
    ? await loadSubject(supabase, parsed.data.subjectId)
    : null;
  const existing = subject ? await existingConcepts(supabase, subject.id) : [];

  const spend = collectSpend();
  const result = await generateChain({
    goal: parsed.data.goal,
    subject: subject?.name ?? null,
    existing,
    anthropicApiKey: apiKey,
    onSpend: spend.sink,
  });
  await recordLearnSpend(user.id, 'generate-chain', spend.reports);

  if (!result.ok) return { error: result.detail };
  return { chain: result.chain, asked: parsed.data.goal };
}

/**
 * The shape the proposal rides back in.
 *
 * Re-validated rather than trusted: it went out to a browser and came back, so
 * it is user input whoever wrote the form, and this is the last point before
 * rows are written.
 */
const chainSchema = z.object({
  subject: z.string().trim().min(1).max(200),
  goalConcept: z.string().trim().min(1).max(200),
  nodes: z
    .array(
      proposedConceptSchema.extend({
        // A claim and basis are empty only for an existing node the chain
        // pulled in to stay readable; that one already has both in its row.
        claim: z.string().trim().max(1000),
        basis: z.string().trim().max(500),
        existingId: z.string().uuid().nullable(),
      }),
    )
    .min(1)
    .max(20),
  edges: z.array(proposedEdgeSchema).max(40),
  joined: z.number().int().min(0),
  dropped: z.array(z.object({ name: z.string(), reason: z.string() })).max(40),
});

export async function approveChain(
  _prev: ApproveState,
  formData: FormData,
): Promise<ApproveState> {
  const user = await requireUser();

  const asked = z
    .string()
    .trim()
    .min(1)
    .max(300)
    .safeParse(formData.get('asked'));
  if (!asked.success) return { error: 'Could not work out which goal this was.' };

  const raw = formData.get('chain');
  if (typeof raw !== 'string') return { error: 'There is nothing here to approve.' };

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return { error: 'That proposal did not survive the trip. Ask again.' };
  }

  const safe = chainSchema.safeParse(payload);
  if (!safe.success) return { error: 'That proposal did not survive the trip. Ask again.' };

  const supabase = await createLearnClient();
  let subjectId: string;
  try {
    const saved = await saveChain(supabase, user.id, safe.data as ProposedChain, asked.data);
    subjectId = saved.subjectId;
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Could not save that chain.' };
  }

  revalidatePath('/learn/know');
  revalidatePath(`/learn/s/${subjectId}`);
  redirect(`/learn/s/${subjectId}`);
}
