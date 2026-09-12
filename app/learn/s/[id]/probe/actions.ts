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
  setMisconception,
} from '@/lib/learn/graph/session';
import { nameMisconception, repeatedWrongAnswer } from '@/lib/learn/graph/misconception';
import { proposeFloor } from '@/lib/learn/graph/floor';
import { existingConcepts, saveChain } from '@/lib/learn/graph/save';
import { loadSubject } from '@/lib/learn/graph/load';
import { prerequisiteMap, type Concept } from '@/lib/learn/graph/model';
import { approvedChainSchema, type ProposedChain } from '@/lib/learn/graph/chain-payload';
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
  answered?: {
    correct: boolean;
    reason: string;
    correctIndex: number;
    chosenIndex: number;
    /** Named only when the same wrong answer has now been picked twice. */
    misconception?: string;
    /** True when this claim has nothing under it, so the floor can be looked for. */
    couldGoDeeper?: boolean;
  };
};

const MODEL_FOR_PROBES = 'claude-haiku-4-5';

// latency: pending
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

  // A concept can be named, which is what the row on /learn/next does: ask
  // about this one rather than whichever one the session would have picked.
  // Only the first question carries it -- the form that asks for another does
  // not -- so a session started this way goes on choosing for itself.
  const named = formData.get('conceptId');
  const asking = typeof named === 'string' && named.length > 0 ? named : null;

  let concept: Concept | null;
  if (asking !== null) {
    const wanted = z.string().uuid().safeParse(asking);
    if (!wanted.success) return { error: 'Could not work out which claim to ask about.' };

    // The graph is this subject's, so a concept missing from it is a concept
    // in somebody else's subject or none. Said rather than swallowed: asking
    // about a different claim than the one pressed would be worse.
    concept = graph.concepts.find((c) => c.id === wanted.data) ?? null;
    if (!concept) return { error: 'That claim is not in this subject.' };
  } else {
    const asked = new Map<string, number>();
    for (const c of graph.concepts) {
      asked.set(c.id, (await probesFor(supabase, c.id)).length);
    }
    concept = nextConcept(graph.concepts, asked);
  }

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

// latency: pending
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
      graph,
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

  // The same wrong answer twice is a position rather than a slip, and worth
  // one call to name. Nothing here can fail loudly: a misconception that could
  // not be named leaves the concept shaky, which is what the answer already
  // made it, rather than half-marked.
  let misconception: string | undefined;
  const repeated = outcome.correct ? null : repeatedWrongAnswer(probes);
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (repeated && concept && apiKey) {
    const spend = collectSpend();
    const named = await nameMisconception({
      concept: concept.name,
      claim: concept.claim,
      wrongAnswer: repeated.option,
      questions: probes
        .filter(
          (probe) =>
            probe.chosenIndex !== null &&
            probe.options[probe.chosenIndex]?.trim().toLowerCase() ===
              repeated.option.trim().toLowerCase(),
        )
        .map((probe) => probe.question),
      anthropicApiKey: apiKey,
      onSpend: spend.sink,
    });
    await recordLearnSpend(user.id, 'name-misconception', spend.reports);

    if (named.ok) {
      try {
        await setMisconception(supabase, user.id, parsed.data.conceptId, named.misconception);
        misconception = named.misconception;
      } catch {
        // The answer is already recorded and the concept is already shaky.
        // Failing to name the belief loses a sentence, not the evidence.
      }
    }
  }

  // Growth trigger 2. Getting something wrong with nothing underneath it in
  // the graph is a fact about the graph first: there is nothing to fall back
  // to and nothing to be told to learn instead, which means the chain was
  // drawn starting too high. Offered rather than done, since it is generated
  // at the moment somebody is least inclined to argue with it.
  const prerequisites = prerequisiteMap(graph).get(parsed.data.conceptId) ?? [];
  const couldGoDeeper = !outcome.correct && prerequisites.length === 0;

  return {
    ...prev,
    error: undefined,
    percent: barPercent(weight),
    answered: {
      correct: outcome.correct,
      reason: outcome.reason,
      correctIndex: answeredRow?.correctIndex ?? -1,
      chosenIndex: parsed.data.chosenIndex,
      misconception,
      couldGoDeeper,
    },
  };
}

export type FloorState = {
  error?: string;
  /** Proposed, not saved. Nothing reaches the graph until it is approved. */
  chain?: ProposedChain;
  message?: string;
};

/**
 * Work out what a missed claim rests on.
 *
 * Writes nothing, like every other generated graph in this module. The
 * approval matters more here than usual: this is proposed at the moment
 * somebody has just got something wrong, which is exactly when they are least
 * likely to push back on being told what they are missing.
 */
// latency: pending
export async function findFloor(_prev: FloorState, formData: FormData): Promise<FloorState> {
  const user = await requireUser();

  const conceptId = z.string().uuid().safeParse(formData.get('conceptId'));
  const subjectId = z.string().uuid().safeParse(formData.get('subjectId'));
  if (!conceptId.success || !subjectId.success) {
    return { error: 'Could not work out which claim that was.' };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { error: 'This needs ANTHROPIC_API_KEY to be set.' };

  const supabase = await createLearnClient();
  const [subject, graph] = await Promise.all([
    loadSubject(supabase, subjectId.data),
    loadGraph(supabase, subjectId.data),
  ]);
  const concept = graph.concepts.find((c) => c.id === conceptId.data);
  if (!subject || !concept) return { error: 'That is not there any more.' };

  const missed = (await probesFor(supabase, concept.id)).find(
    (probe) => probe.chosenIndex !== null && probe.chosenIndex !== probe.correctIndex,
  );

  const spend = collectSpend();
  const result = await proposeFloor({
    subject: subject.name,
    concept: concept.name,
    claim: concept.claim,
    existing: await existingConcepts(supabase, subject.id),
    missedQuestion: missed?.question ?? null,
    anthropicApiKey: apiKey,
    onSpend: spend.sink,
  });
  await recordLearnSpend(user.id, 'propose-floor', spend.reports);

  if (!result.ok) {
    return result.reason === 'nothing-missing'
      ? { message: result.detail }
      : { error: result.detail };
  }

  return { chain: result.chain };
}

/**
 * Attach an approved floor.
 *
 * The same writer as an approved goal chain, minus the goal: this is adding a
 * level to a subject somebody is already working on, not starting something
 * new, so no goal row is created and the existing ones simply grow a rung.
 */
// latency: pending
export async function approveFloor(_prev: FloorState, formData: FormData): Promise<FloorState> {
  const user = await requireUser();

  const subjectId = z.string().uuid().safeParse(formData.get('subjectId'));
  if (!subjectId.success) return { error: 'Could not work out which subject that was.' };

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
  const chain = safe.data as ProposedChain;

  const supabase = await createLearnClient();
  try {
    await saveChain(supabase, user.id, chain, chain.goalConcept, { goal: false });
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Could not save that.' };
  }

  revalidatePath(`/learn/s/${subjectId.data}`);
  return { message: 'Added underneath. It will show up as the next thing to learn.' };
}
