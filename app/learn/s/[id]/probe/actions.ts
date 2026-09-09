'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import { loadGraph } from '@/lib/learn/graph/load';
import { writeProbe } from '@/lib/learn/graph/probe';
import { collectSpend, recordLearnSpend } from '@/lib/learn/spend';
import {
  answeredWeight,
  nextConcept,
  probesFor,
  recordAnswer,
  recordProbe,
} from '@/lib/learn/graph/session';
import { barPercent } from '@/lib/learn/graph/probe-payload';

/**
 * Asking, and answering.
 *
 * Two actions and no session object between them. The question is written and
 * stored before it is shown, so the answer only has to name the row it is
 * answering -- which means a closed tab loses nothing, and the bar is always a
 * fact about the rows rather than about a variable somebody was holding.
 */

export type AskState = {
  error?: string;
  probeId?: string;
  conceptId?: string;
  conceptName?: string;
  question?: string;
  options?: string[];
  /** Where the bar stood before this question. */
  percent?: number;
  /** Filled in once answered, by the answer action. */
  answered?: { correct: boolean; reason: string; correctIndex: number; chosenIndex: number };
};

const MODEL_FOR_PROBES = 'claude-haiku-4-5';

export async function askQuestion(_prev: AskState, formData: FormData): Promise<AskState> {
  const user = await requireUser();

  const subjectId = z.string().uuid().safeParse(formData.get('subjectId'));
  if (!subjectId.success) return { error: 'Could not work out which subject this is.' };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { error: 'Probing needs ANTHROPIC_API_KEY to be set.' };

  const supabase = await createLearnClient();
  const graph = await loadGraph(supabase, subjectId.data);
  if (graph.concepts.length === 0) {
    return { error: 'Nothing in this subject to ask about yet.' };
  }

  const asked = new Map<string, number>();
  for (const concept of graph.concepts) {
    asked.set(concept.id, (await probesFor(supabase, concept.id)).length);
  }

  const concept = nextConcept(graph.concepts, asked);
  if (!concept) return { error: 'Nothing in this subject to ask about yet.' };

  const previous = await probesFor(supabase, concept.id);
  const spend = collectSpend();
  const result = await writeProbe({
    concept: concept.name,
    claim: concept.claim,
    asked: previous.map((probe) => probe.question),
    missedBefore: previous.some(
      (probe) => probe.chosenIndex !== null && probe.chosenIndex !== probe.correctIndex,
    ),
    anthropicApiKey: apiKey,
    onSpend: spend.sink,
  });
  await recordLearnSpend(user.id, 'write-probe', spend.reports);

  if (!result.ok) return { error: result.detail };

  const probeId = await recordProbe(supabase, user.id, {
    conceptId: concept.id,
    probe: result.probe,
    model: MODEL_FOR_PROBES,
  });

  const weight = await answeredWeight(
    supabase,
    graph.concepts.map((c) => c.id),
  );

  return {
    probeId,
    conceptId: concept.id,
    conceptName: concept.name,
    question: result.probe.question,
    options: result.probe.options,
    percent: barPercent(weight),
  };
}

const AnswerInput = z.object({
  probeId: z.string().uuid(),
  conceptId: z.string().uuid(),
  subjectId: z.string().uuid(),
  chosenIndex: z.coerce.number().int().min(0).max(5),
});

export async function answerQuestion(prev: AskState, formData: FormData): Promise<AskState> {
  const user = await requireUser();

  const parsed = AnswerInput.safeParse({
    probeId: formData.get('probeId'),
    conceptId: formData.get('conceptId'),
    subjectId: formData.get('subjectId'),
    chosenIndex: formData.get('chosenIndex'),
  });
  if (!parsed.success) return { ...prev, error: 'Could not work out what you picked.' };

  const supabase = await createLearnClient();
  const graph = await loadGraph(supabase, parsed.data.subjectId);
  const concept = graph.concepts.find((c) => c.id === parsed.data.conceptId);

  let outcome;
  try {
    outcome = await recordAnswer(supabase, user.id, {
      probeId: parsed.data.probeId,
      conceptId: parsed.data.conceptId,
      chosenIndex: parsed.data.chosenIndex,
      wasSettled: concept?.state === 'known',
    });
  } catch (error) {
    return { ...prev, error: error instanceof Error ? error.message : 'Could not save that.' };
  }

  const weight = await answeredWeight(
    supabase,
    graph.concepts.map((c) => c.id),
  );

  revalidatePath(`/learn/s/${parsed.data.subjectId}`);

  const probes = await probesFor(supabase, parsed.data.conceptId);
  const answeredRow = probes.find((probe) => probe.id === parsed.data.probeId);

  return {
    ...prev,
    error: undefined,
    percent: barPercent(weight),
    answered: {
      correct: outcome.correct,
      reason: outcome.reason,
      correctIndex: answeredRow?.correctIndex ?? -1,
      chosenIndex: parsed.data.chosenIndex,
    },
  };
}
