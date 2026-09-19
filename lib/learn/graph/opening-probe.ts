import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { forceTool, whyNoReport } from '@/lib/learn/graph/tool-call';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import {
  openingGradeSchema,
  openingQuestionSchema,
  toWrittenQuestion,
  type OpeningClaim,
  type OpeningQuestionRejection,
} from '@/lib/learn/graph/opening-payload';

/**
 * The question asked about each of the ten claims, and the grading of what
 * somebody writes back.
 *
 * Written answers rather than options, which is #319: on a subject nobody has
 * studied, one right answer in four is a guess, and a guess would seed a
 * concept as known. So the writer produces a question and the answer it
 * expects, and the grader compares what was typed against that.
 *
 * Haiku for both, for the same reason the probe writer uses it: one claim in,
 * one tightly constrained thing out, no judgment about a field and nothing to
 * search. Ten questions and ten gradings is about four cents a subject.
 *
 * A claim whose question fails its own check is dropped and named, and the
 * sweep runs with nine. One bad claim should not cost the opening.
 */

export const OPENING_MODEL = 'claude-haiku-4-5';
const WRITE_TOOL = 'report_question';
const GRADE_TOOL = 'report_grade';

/**
 * How many calls are allowed to be running at once.
 *
 * Ten at once is ten chances to be rate limited on a screen somebody is
 * waiting in front of, and the wall clock barely moves past four.
 */
export const MAX_IN_FLIGHT = 4;

const WRITE_SYSTEM = `You write one question testing whether somebody holds one specific claim,
to be answered from memory in a phrase or a sentence.

They are about to start this subject and have not studied it here. Most answers
will be wrong, and that is expected: the question is a measurement of what they
can already produce, not a test they are meant to pass.

ANSWERABLE IN A PHRASE OR A SENTENCE, WITHOUT LOOKING ANYTHING UP. No
derivations, no numbers to compute, nothing that needs a source open.

ASK WHAT FOLLOWS, NOT WHAT IT IS CALLED. Never ask for a term. Somebody who
cannot produce the word and can say what happens holds the idea, and a question
about the name would call them wrong.

DO NOT PUT THE ANSWER IN THE QUESTION. A question somebody can answer by
reading it back measures nothing.

WRITE THE ANSWER YOU EXPECT, in one or two sentences, in terms of the idea. It
is what a written answer is graded against and it is shown afterwards, so it
has to stand on its own.

IF THE CLAIM CANNOT CARRY A QUESTION LIKE THAT -- too vague to be right or
wrong about, or a definition and nothing else -- set unusable true and write
nothing.`;

const GRADE_SYSTEM = `You are grading a written answer against the claim it was asked about.

GRADE THE IDEA, NOT THE WORDING. The answer is typed from memory by somebody
starting a subject. Different words, a rough phrasing, a missing term: all
right, if what they said is the thing the claim says.

WRONG MEANS WRONG. Right direction with the wrong mechanism is wrong. Restating
the question is wrong. Saying nothing in more words is wrong. Being close is
wrong -- half credit here would seed a concept as known on the strength of a
guess.

Write your reasoning in one sentence first, then set correct.`;

export type WrittenOpeningQuestion = {
  claimName: string;
  claim: string;
  question: string;
  expected: string;
};

export type DroppedClaim = {
  name: string;
  reason: OpeningQuestionRejection | 'error';
};

export type OpeningQuestionsResult = {
  /** In the order the claims came in, minus the ones that were dropped. */
  questions: WrittenOpeningQuestion[];
  dropped: DroppedClaim[];
};

/**
 * Run one job per item, never more than `cap` of them at a time.
 *
 * Results come back in the order the items were given, whatever order the
 * calls finished in: the sweep is asked in the order the claims were named.
 *
 * Exported for the quiz writer, which has the same shape of problem -- several
 * small calls behind one screen somebody is waiting in front of.
 */
export async function mapWithCap<T, R>(
  items: T[],
  cap: number,
  run: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  async function worker(): Promise<void> {
    for (let index = next++; index < items.length; index = next++) {
      results[index] = await run(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(cap, items.length) }, () => worker()));
  return results;
}

type WriteOutcome =
  | { ok: true; question: WrittenOpeningQuestion }
  | { ok: false; dropped: DroppedClaim };

async function writeOne(
  client: Anthropic,
  input: { subject: string; claim: OpeningClaim; onSpend?: SpendSink },
): Promise<WriteOutcome> {
  let response;
  try {
    response = await client.messages.create({
      model: OPENING_MODEL,
      max_tokens: 1024,
      system: WRITE_SYSTEM,
      tools: [
        {
          name: WRITE_TOOL,
          description: 'Report the question and the answer it expects.',
          input_schema: {
            type: 'object',
            properties: {
              question: { type: 'string' },
              expected: { type: 'string' },
              unusable: { type: 'boolean' },
            },
            required: ['question', 'expected'],
          },
        },
      ],
      tool_choice: forceTool(WRITE_TOOL),
      messages: [
        {
          role: 'user',
          content: [
            `Subject: ${input.subject}`,
            `Concept: ${input.claim.name}`,
            '',
            `The claim: ${input.claim.claim}`,
            '',
            `Call ${WRITE_TOOL}.`,
          ].join('\n'),
        },
      ],
    });
  } catch {
    return { ok: false, dropped: { name: input.claim.name, reason: 'error' } };
  }

  // Before the answer is judged: a useless one still cost what it cost.
  input.onSpend?.({ model: OPENING_MODEL, usage: usageFrom(response.usage) });

  const block = response.content.find((c) => c.type === 'tool_use' && c.name === WRITE_TOOL);
  if (!block || block.type !== 'tool_use') {
    return { ok: false, dropped: { name: input.claim.name, reason: 'error' } };
  }

  const safe = openingQuestionSchema.safeParse(block.input);
  if (!safe.success) {
    return { ok: false, dropped: { name: input.claim.name, reason: 'error' } };
  }

  const checked = toWrittenQuestion(safe.data);
  if (!checked.ok) {
    return { ok: false, dropped: { name: input.claim.name, reason: checked.reason } };
  }

  return {
    ok: true,
    question: {
      claimName: input.claim.name,
      claim: input.claim.claim,
      question: checked.question.question,
      expected: checked.question.expected,
    },
  };
}

/**
 * Write one question per claim. Never throws.
 *
 * Every claim gets its own call, so a claim that comes back unusable costs one
 * question rather than the sweep. What was dropped is named in the result,
 * because a sweep that quietly asks eight questions instead of ten is a
 * measurement nobody can read.
 */
export async function writeOpeningQuestions(input: {
  subject: string;
  claims: OpeningClaim[];
  anthropicApiKey: string;
  client?: Anthropic;
  onSpend?: SpendSink;
  /** Overridden only by the tests that check the cap holds. */
  maxInFlight?: number;
}): Promise<OpeningQuestionsResult> {
  const client = input.client ?? new Anthropic({ apiKey: input.anthropicApiKey });

  const outcomes = await mapWithCap(
    input.claims,
    input.maxInFlight ?? MAX_IN_FLIGHT,
    (claim) => writeOne(client, { subject: input.subject, claim, onSpend: input.onSpend }),
  );

  return {
    questions: outcomes.filter((o) => o.ok).map((o) => o.question),
    dropped: outcomes.filter((o) => !o.ok).map((o) => o.dropped),
  };
}

export type WrittenGrade =
  | { ok: true; correct: boolean; why: string }
  | { ok: false; detail: string };

/** The sweep's own name for it, kept so its callers read the same as before. */
export type OpeningGrade = WrittenGrade;

/**
 * Grade one written answer. Never throws.
 *
 * Right or wrong and nothing between, which is what the three outcomes allow
 * and what #319 asked for: half credit would seed a concept as known on the
 * strength of a guess, and a concept marked known is one the views stop
 * showing you.
 *
 * The caller brings its own system prompt and its own lines of context, so a
 * quiz over your notes and a sweep over a subject are graded by one call with
 * one schema rather than by two graders that drift apart.
 */
export async function gradeWrittenAnswer(input: {
  system: string;
  /** What the question was about, above the question itself. May be empty. */
  context: readonly string[];
  question: string;
  expected: string;
  response: string;
  anthropicApiKey: string;
  client?: Anthropic;
  onSpend?: SpendSink;
}): Promise<WrittenGrade> {
  const client = input.client ?? new Anthropic({ apiKey: input.anthropicApiKey });

  let response;
  try {
    response = await client.messages.create({
      model: OPENING_MODEL,
      max_tokens: 512,
      system: input.system,
      tools: [
        {
          name: GRADE_TOOL,
          description: 'Report whether the written answer is the one expected.',
          input_schema: {
            type: 'object',
            properties: {
              why: { type: 'string' },
              correct: { type: 'boolean' },
            },
            required: ['why', 'correct'],
          },
        },
      ],
      tool_choice: forceTool(GRADE_TOOL),
      messages: [
        {
          role: 'user',
          content: [
            ...input.context,
            '',
            `Question asked: ${input.question}`,
            `Answer expected: ${input.expected}`,
            '',
            `What they wrote: ${input.response}`,
            '',
            `Call ${GRADE_TOOL}.`,
          ].join('\n'),
        },
      ],
    });
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : 'Grading failed.' };
  }

  input.onSpend?.({ model: OPENING_MODEL, usage: usageFrom(response.usage) });

  const block = response.content.find((c) => c.type === 'tool_use' && c.name === GRADE_TOOL);
  if (!block || block.type !== 'tool_use') {
    return { ok: false, detail: whyNoReport(response) };
  }

  const safe = openingGradeSchema.safeParse(block.input);
  if (!safe.success) return { ok: false, detail: 'The grade came back malformed.' };

  return { ok: true, correct: safe.data.correct, why: safe.data.why };
}

/** Grade one answer from the opening sweep, against the claim it was asked about. */
export async function gradeOpeningAnswer(input: {
  claim: OpeningClaim;
  question: string;
  expected: string;
  response: string;
  anthropicApiKey: string;
  client?: Anthropic;
  onSpend?: SpendSink;
}): Promise<OpeningGrade> {
  return gradeWrittenAnswer({
    ...input,
    system: GRADE_SYSTEM,
    context: [`Concept: ${input.claim.name}`, `The claim: ${input.claim.claim}`],
  });
}
