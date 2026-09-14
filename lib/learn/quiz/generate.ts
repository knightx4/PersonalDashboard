import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import { MAX_IN_FLIGHT, mapWithCap } from '@/lib/learn/graph/opening-probe';
import { toWrittenQuestion } from '@/lib/learn/graph/opening-payload';
import { planQuizQuestions, type PlannableSource, type QuizChunk } from '@/lib/learn/quiz/plan';
import { quizChunkSchema, MIN_QUIZ_QUESTIONS, QUIZ_QUESTIONS } from '@/lib/learn/quiz/payload';

/**
 * Turning the material you picked into questions.
 *
 * One call per piece of the material rather than one call over all of it,
 * which is what lets a long note be asked about across its length instead of
 * across its first page -- lib/learn/quiz/plan.ts decides which pieces and how
 * many each is owed. Haiku, a tool call, and the payload through a schema
 * before any row is written, the same shape as the opening sweep's writer.
 *
 * Written answers rather than four options, for the reason #319 settled on the
 * sweep: recognising the right answer out of four is a different thing from
 * producing it, and this is the screen where that difference is the point.
 *
 * Nothing here writes. The questions come back and the caller stores them, so
 * a call that half succeeded cannot leave a quiz holding four questions and
 * claiming ten.
 */

export const QUIZ_MODEL = 'claude-haiku-4-5';
const TOOL_NAME = 'report_questions';

const SYSTEM = `You write quiz questions from material somebody chose to be tested on. They
will answer from memory, in their own words, in a phrase or a sentence.

ASK ABOUT WHAT THIS MATERIAL SAYS. Not the subject in general and not what you
know about it. If the answer is not in the text in front of you, it is not a
question for this quiz.

SPREAD THEM ACROSS THE PIECE. Several questions from one paragraph leave the
rest untested.

ANSWERABLE IN A PHRASE OR A SENTENCE, FROM MEMORY. No derivations, no numbers
to compute, nothing that needs the material open.

ASK WHAT FOLLOWS, NOT WHAT IT IS CALLED. Never ask for a term. Somebody who
cannot produce the word and can say what happens holds the idea, and a question
about the name would call them wrong.

DO NOT PUT THE ANSWER IN THE QUESTION. A question somebody can answer by
reading it back measures nothing.

WRITE THE ANSWER YOU EXPECT, in one or two sentences, in the terms the material
uses. It is what a written answer is graded against and it is shown afterwards,
so it has to stand on its own.

IF THE PIECE HAS NOTHING ANSWERABLE IN IT -- a contents page, a list of links,
a table of numbers, a stub of two lines -- set nothing_in_it true and write no
questions. A made-up question is worse than a shorter quiz.`;

/** A question written from one piece of the material, before it is stored. */
export type WrittenQuizQuestion = {
  sourceId: string;
  question: string;
  expected: string;
};

export type QuizGenerationResult = {
  /** In the order the material was picked, and the order they get asked in. */
  questions: WrittenQuizQuestion[];
  /** Pieces that came back with nothing, named so a short quiz can say why. */
  empty: string[];
  /** Pieces whose call failed or whose answer would not parse. */
  failed: string[];
};

function aimedAt(preparingFor: string | null): string[] {
  if (!preparingFor) return [];
  return [
    `They are preparing for: ${preparingFor}`,
    'Aim the questions at what that would ask of them, where this material lets you.',
    '',
  ];
}

async function writeChunk(
  client: Anthropic,
  chunk: QuizChunk,
  input: { preparingFor: string | null; onSpend?: SpendSink },
): Promise<{ questions: WrittenQuizQuestion[]; empty: boolean; failed: boolean }> {
  let response;
  try {
    response = await client.messages.create({
      model: QUIZ_MODEL,
      max_tokens: 2048,
      system: SYSTEM,
      tools: [
        {
          name: TOOL_NAME,
          description: 'Report the questions and the answer each one expects.',
          input_schema: {
            type: 'object',
            properties: {
              questions: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    question: { type: 'string' },
                    expected: { type: 'string' },
                  },
                  required: ['question', 'expected'],
                },
              },
              nothing_in_it: { type: 'boolean' },
            },
            required: ['questions'],
          },
        },
      ],
      messages: [
        {
          role: 'user',
          content: [
            ...aimedAt(input.preparingFor),
            `Write ${chunk.want} ${chunk.want === 1 ? 'question' : 'questions'} from this piece of the material.`,
            '',
            `From: ${chunk.title}`,
            '',
            chunk.text,
            '',
            `Call ${TOOL_NAME}.`,
          ].join('\n'),
        },
      ],
    });
  } catch {
    return { questions: [], empty: false, failed: true };
  }

  // Before the answer is judged: a useless one still cost what it cost.
  input.onSpend?.({ model: QUIZ_MODEL, usage: usageFrom(response.usage) });

  const block = response.content.find((c) => c.type === 'tool_use' && c.name === TOOL_NAME);
  if (!block || block.type !== 'tool_use') {
    return { questions: [], empty: false, failed: true };
  }

  const safe = quizChunkSchema.safeParse(block.input);
  if (!safe.success) return { questions: [], empty: false, failed: true };
  if (safe.data.nothing_in_it) return { questions: [], empty: true, failed: false };

  const questions: WrittenQuizQuestion[] = [];
  for (const raw of safe.data.questions.slice(0, chunk.want)) {
    // The two mechanical checks the opening sweep already applies. A question
    // that fails one is dropped rather than repaired: writing the missing half
    // here would mean inventing the thing the answer is graded against.
    const checked = toWrittenQuestion({ ...raw, unusable: false });
    if (!checked.ok) continue;
    questions.push({
      sourceId: chunk.sourceId,
      question: checked.question.question,
      expected: checked.question.expected,
    });
  }

  return { questions, empty: questions.length === 0, failed: false };
}

/**
 * Write a quiz's questions from its material. Never throws.
 *
 * A piece that comes back with nothing costs that piece rather than the quiz,
 * and what was left out is named -- a quiz that quietly asks four questions
 * instead of ten is a measurement nobody can read.
 */
export async function writeQuizQuestions(input: {
  sources: readonly PlannableSource[];
  preparingFor: string | null;
  anthropicApiKey: string;
  client?: Anthropic;
  onSpend?: SpendSink;
  /** What the quiz aims at. Overridden only by tests. */
  target?: number;
  maxInFlight?: number;
}): Promise<QuizGenerationResult> {
  const chunks = planQuizQuestions(input.sources, input.target ?? QUIZ_QUESTIONS);
  if (chunks.length === 0) return { questions: [], empty: [], failed: [] };

  const client = input.client ?? new Anthropic({ apiKey: input.anthropicApiKey });

  const outcomes = await mapWithCap(chunks, input.maxInFlight ?? MAX_IN_FLIGHT, (chunk) =>
    writeChunk(client, chunk, { preparingFor: input.preparingFor, onSpend: input.onSpend }),
  );

  return {
    questions: outcomes.flatMap((outcome) => outcome.questions),
    empty: chunks.filter((_, index) => outcomes[index]!.empty).map((chunk) => chunk.title),
    failed: chunks.filter((_, index) => outcomes[index]!.failed).map((chunk) => chunk.title),
  };
}

/** Whether what came back is worth storing as a quiz. */
export function enoughToAsk(result: QuizGenerationResult): boolean {
  return result.questions.length >= MIN_QUIZ_QUESTIONS;
}
