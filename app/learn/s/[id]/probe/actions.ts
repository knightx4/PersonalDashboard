'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import { loadGraph } from '@/lib/learn/graph/load';
import { PROBE_MODEL, writeProbe } from '@/lib/learn/graph/probe';
import { collectSpend, recordLearnSpend } from '@/lib/learn/spend';
import {
  answeredCount,
  answeredWeight,
  nextConcept,
  nextRung,
  probesFor,
  recordAnswer,
  recordAppliedCase,
  recordProbe,
  recordWrittenAnswer,
  setMisconception,
  type ProbeRow,
} from '@/lib/learn/graph/session';
import { APPLIED_MODEL, gradeAppliedAnswer, writeAppliedCase } from '@/lib/learn/graph/applied';
import { splitCase } from '@/lib/learn/graph/applied-payload';
import { nameMisconception, repeatedWrongAnswer } from '@/lib/learn/graph/misconception';
import { answerKind, recordOutcome } from '@/lib/learn/next/record';
import { proposeFloor } from '@/lib/learn/graph/floor';
import { declareConceptKnown, existingConcepts, saveChain } from '@/lib/learn/graph/save';
import { loadSubject } from '@/lib/learn/graph/load';
import { isSettled, prerequisiteMap, type Concept, type Graph } from '@/lib/learn/graph/model';
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
  /**
   * The case to read, on an applied question. It is the presence of this and
   * the absence of options that tells the screen which rung it is showing.
   */
  situation?: string;
  options?: string[];
  /** Where the bar stood before this question. */
  percent?: number;
  /** Filled in once answered, by the answer action. */
  answered?: {
    correct: boolean;
    /** The reason on a picked answer, the grader's sentence on a typed one. */
    reason: string;
    correctIndex?: number;
    chosenIndex?: number;
    /** What was typed, and the answer the case was written with. Applied only. */
    response?: string;
    expected?: string;
    /** How far this answer moved the bar. Zero when it repeated a miss. */
    weight: number;
    /** Named only when the same wrong answer has now been picked twice. */
    misconception?: string;
    /** True when this claim has nothing under it, so the floor can be looked for. */
    couldGoDeeper?: boolean;
  };
};

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
    // Every fifth question in this subject goes back to the claim here you
    // were asked about longest ago. Counted from the answers stored against
    // this subject's concepts, so it does not move with what you have been
    // doing elsewhere.
    const answered = await answeredCount(
      supabase,
      graph.concepts.map((c) => c.id),
    );
    concept = nextConcept(graph.concepts, asked, { answered, now: new Date() });
  }

  if (!concept) return { error: 'Nothing in this subject to ask about yet.' };

  const previous = await probesFor(supabase, concept.id);
  // Which rung this question is asked at, and which check of understanding it
  // is for. Multiple choice until every check has been got right at least
  // once, and an applied case from then on. The check is null when the concept
  // carries none, and then the question is written against the claim itself.
  const { rung, check } = nextRung(concept.mastery, previous);

  if (rung !== 'recognise') {
    return askApplied({
      userId: user.id,
      supabase,
      concept,
      check,
      previous,
      conceptIds: graph.concepts.map((c) => c.id),
      apiKey,
    });
  }

  const spend = collectSpend();
  const result = await writeProbe({
    concept: concept.name,
    claim: concept.claim,
    check,
    otherChecks: concept.mastery.filter((other) => other !== check),
    // The multiple-choice questions only: an applied case is a different rung
    // and repeating a situation is what `askApplied` guards against.
    asked: previous
      .filter((probe) => probe.rung === 'recognise')
      .map((probe) => probe.question),
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
    model: PROBE_MODEL,
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

/**
 * The applied rung: a case to read and a box to type into.
 *
 * Written and stored before it is shown, exactly as a multiple-choice question
 * is, so the answer only has to name the row it is answering and a closed tab
 * loses nothing. The situations already used for this claim go into the call,
 * which is what stops the second case being the first one again.
 */
async function askApplied(input: {
  userId: string;
  supabase: Awaited<ReturnType<typeof createLearnClient>>;
  concept: Concept;
  check: string | null;
  previous: ProbeRow[];
  conceptIds: string[];
  apiKey: string;
}): Promise<AskState> {
  const spend = collectSpend();
  const result = await writeAppliedCase({
    concept: input.concept.name,
    claim: input.concept.claim,
    check: input.check,
    asked: input.previous
      .filter((probe) => probe.rung !== 'recognise')
      .map((probe) => splitCase(probe.question).situation),
    anthropicApiKey: input.apiKey,
    onSpend: spend.sink,
  });
  await recordLearnSpend(input.userId, 'write-applied-case', spend.reports);

  if (!result.ok) return { error: result.detail };

  const probeId = await recordAppliedCase(input.supabase, input.userId, {
    conceptId: input.concept.id,
    case: result.case,
    model: APPLIED_MODEL,
  });

  const weight = await answeredWeight(input.supabase, input.conceptIds);

  return {
    probeId,
    conceptId: input.concept.id,
    conceptName: input.concept.name,
    situation: result.case.situation,
    question: result.case.question,
    percent: barPercent(weight),
  };
}

const AnsweredQuestion = z.object({
  probeId: z.string().uuid(),
  conceptId: z.string().uuid(),
  subjectId: z.string().uuid(),
});

const PickedAnswer = z.object({ chosenIndex: z.coerce.number().int().min(0).max(5) });
const TypedAnswer = z.object({ response: z.string().trim().min(1).max(2000) });

// latency: pending
export async function answerQuestion(prev: AskState, formData: FormData): Promise<AskState> {
  const user = await requireUser();

  const asked = AnsweredQuestion.safeParse({
    probeId: formData.get('probeId'),
    conceptId: formData.get('conceptId'),
    subjectId: formData.get('subjectId'),
  });
  if (!asked.success) return { ...prev, error: 'Could not work out what you answered.' };

  const supabase = await createLearnClient();
  const graph = await loadGraph(supabase, asked.data.subjectId);
  const concept = graph.concepts.find((c) => c.id === asked.data.conceptId);

  // Which rung this is comes from the row rather than from the form. The row
  // is what decides whether an index or a paragraph is the answer to it, and
  // it is the half of this the browser did not write.
  const askedRow = (await probesFor(supabase, asked.data.conceptId)).find(
    (probe) => probe.id === asked.data.probeId,
  );
  if (!askedRow) return { ...prev, error: 'That question is not there any more.' };

  if (askedRow.rung !== 'recognise') {
    return answerApplied({
      prev,
      userId: user.id,
      supabase,
      graph,
      concept,
      probe: askedRow,
      subjectId: asked.data.subjectId,
      typed: formData.get('response'),
    });
  }

  const parsed = PickedAnswer.safeParse({ chosenIndex: formData.get('chosenIndex') });
  if (!parsed.success) return { ...prev, error: 'Could not work out what you picked.' };

  let outcome;
  try {
    outcome = await recordAnswer(supabase, user.id, {
      probeId: asked.data.probeId,
      conceptId: asked.data.conceptId,
      chosenIndex: parsed.data.chosenIndex,
      // Only for a concept with no checks. One that carries them is weighed by
      // what earlier answers did with the check this question aimed at, and
      // whether the concept as a whole was settled decides nothing.
      wasSettled: concept !== undefined && concept.mastery.length === 0 && isSettled(concept),
      graph,
    });
  } catch (error) {
    return { ...prev, error: error instanceof Error ? error.message : 'Could not save that.' };
  }

  // What Learn next orders from. Written here rather than when the page drew
  // the row: opening the page and closing it again leaves nothing behind, and
  // answering is the thing you did. A second answer to the same question is a
  // person clicking again, so it is not a second thing done about the claim.
  if (outcome.first) {
    await recordOutcome(supabase, user.id, {
      // Where the claim stood before this answer, which is the list it was
      // offered from: a settled claim only ever appears as a re-check.
      kind: answerKind(concept !== undefined && isSettled(concept)),
      conceptId: asked.data.conceptId,
      outcome: 'answered',
    });
  }

  const weight = await answeredWeight(
    supabase,
    graph.concepts.map((c) => c.id),
  );

  revalidatePath(`/learn/s/${asked.data.subjectId}`);

  const probes = await probesFor(supabase, asked.data.conceptId);
  const answeredRow = probes.find((probe) => probe.id === asked.data.probeId);

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
            probe.options?.[probe.chosenIndex]?.trim().toLowerCase() ===
              repeated.option.trim().toLowerCase(),
        )
        .map((probe) => probe.question),
      anthropicApiKey: apiKey,
      onSpend: spend.sink,
    });
    await recordLearnSpend(user.id, 'name-misconception', spend.reports);

    if (named.ok) {
      try {
        await setMisconception(supabase, user.id, asked.data.conceptId, named.misconception);
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
  const prerequisites = prerequisiteMap(graph).get(asked.data.conceptId) ?? [];
  const couldGoDeeper = !outcome.correct && prerequisites.length === 0;

  return {
    ...prev,
    error: undefined,
    percent: barPercent(weight),
    answered: {
      correct: outcome.correct,
      reason: outcome.reason,
      weight: outcome.weight,
      correctIndex: answeredRow?.correctIndex ?? -1,
      chosenIndex: parsed.data.chosenIndex,
      misconception,
      couldGoDeeper,
    },
  };
}

/**
 * Grade what was typed about a case, and record it.
 *
 * The grading is a model call and the recording is not, so a grade that never
 * came back leaves the row exactly as it was: the case is still there to
 * answer, and pressing again asks for the grade again rather than storing a
 * verdict nobody made. The answer that was expected is read off the row it was
 * written on and shown afterwards, so it is the answer the case was built
 * around rather than a reply to whatever was typed.
 */
async function answerApplied(input: {
  prev: AskState;
  userId: string;
  supabase: Awaited<ReturnType<typeof createLearnClient>>;
  graph: Graph;
  concept: Concept | undefined;
  probe: ProbeRow;
  subjectId: string;
  typed: FormDataEntryValue | null;
}): Promise<AskState> {
  const parsed = TypedAnswer.safeParse({ response: input.typed });
  if (!parsed.success) return { ...input.prev, error: 'Write an answer first.' };
  if (!input.concept) return { ...input.prev, error: 'That claim is not in this subject.' };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ...input.prev, error: 'Grading needs ANTHROPIC_API_KEY to be set.' };

  const { situation, question } = splitCase(input.probe.question);
  const spend = collectSpend();
  const grade = await gradeAppliedAnswer({
    concept: input.concept.name,
    claim: input.concept.claim,
    situation,
    question,
    expected: input.probe.expected ?? '',
    response: parsed.data.response,
    anthropicApiKey: apiKey,
    onSpend: spend.sink,
  });
  await recordLearnSpend(input.userId, 'grade-applied-answer', spend.reports);

  if (!grade.ok) return { ...input.prev, error: grade.detail };

  let outcome;
  try {
    outcome = await recordWrittenAnswer(input.supabase, input.userId, {
      probeId: input.probe.id,
      conceptId: input.concept.id,
      response: parsed.data.response,
      correct: grade.correct,
      why: grade.why,
      // Only for a concept with no checks, the same rule a picked answer
      // follows: one that carries them is weighed by what earlier answers did
      // with the check this case aimed at.
      wasSettled: input.concept.mastery.length === 0 && isSettled(input.concept),
      graph: input.graph,
    });
  } catch (error) {
    return {
      ...input.prev,
      error: error instanceof Error ? error.message : 'Could not save that.',
    };
  }

  if (outcome.first) {
    await recordOutcome(input.supabase, input.userId, {
      kind: answerKind(isSettled(input.concept)),
      conceptId: input.concept.id,
      outcome: 'answered',
    });
  }

  const weight = await answeredWeight(
    input.supabase,
    input.graph.concepts.map((c) => c.id),
  );

  revalidatePath(`/learn/s/${input.subjectId}`);

  // The same offer a missed multiple-choice question makes: getting something
  // wrong with nothing underneath it says the chain was drawn too high.
  const prerequisites = prerequisiteMap(input.graph).get(input.concept.id) ?? [];

  return {
    ...input.prev,
    error: undefined,
    percent: barPercent(weight),
    answered: {
      correct: outcome.correct,
      reason: outcome.reason,
      weight: outcome.weight,
      response: parsed.data.response,
      expected: input.probe.expected ?? undefined,
      couldGoDeeper: !outcome.correct && prerequisites.length === 0,
    },
  };
}

export type DeclareState = {
  error?: string;
  /**
   * The case that was waved through. Held rather than a bare flag so the
   * screen can tell this case from the next one and put the answer box back.
   */
  probeId?: string;
};

/**
 * Wave an applied case through: you already know this one.
 *
 * The third thing that can be done with a question, beside picking an option
 * and typing an answer. Nothing is graded and no model is called, so the
 * concept is settled on your word: `known`, established `declared`, and no
 * `tested_at`, which every screen shows as "you said so".
 *
 * The case row is left exactly as it was written -- no response, no
 * `answered_at` -- so it stays in the concept's history as a case that was put
 * and not answered. Nothing goes to `next_outcomes` either: those record what
 * came of a row Learn next offered, and nothing here was answered or pushed
 * aside.
 *
 * The rung is read off the stored row rather than taken from the form, the
 * same rule `answerQuestion` follows. The button only exists on an applied
 * case, and a multiple-choice question is there to be answered.
 */
// latency: pending
export async function markKnown(_prev: DeclareState, formData: FormData): Promise<DeclareState> {
  const user = await requireUser();

  const asked = AnsweredQuestion.safeParse({
    probeId: formData.get('probeId'),
    conceptId: formData.get('conceptId'),
    subjectId: formData.get('subjectId'),
  });
  if (!asked.success) return { error: 'Could not work out which question that was.' };

  const supabase = await createLearnClient();
  const askedRow = (await probesFor(supabase, asked.data.conceptId)).find(
    (probe) => probe.id === asked.data.probeId,
  );
  if (!askedRow) return { error: 'That question is not there any more.' };
  if (askedRow.rung === 'recognise') return { error: 'Pick one of the answers to this one.' };

  try {
    await declareConceptKnown(supabase, user.id, asked.data.conceptId);
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Could not save that.' };
  }

  revalidatePath(`/learn/s/${asked.data.subjectId}`);
  return { probeId: asked.data.probeId };
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
