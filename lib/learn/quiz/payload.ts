import { z } from 'zod';

/**
 * What comes back from one call over one piece of the material.
 *
 * Pure, so the rules can be checked without a network. The two checks a
 * question has to pass -- it does not ask for a name, and it does not carry
 * its own answer -- are the ones the opening sweep already applies, and they
 * are applied from there rather than written again: a question that gives away
 * its answer measures nothing whichever screen it is on.
 */

export const quizChunkSchema = z.object({
  questions: z
    .array(
      z.object({
        question: z.string().trim().min(1).max(600),
        expected: z.string().trim().min(1).max(600),
      }),
    )
    .max(10)
    .default([]),
  /**
   * Said out loud when the piece has nothing answerable in it -- a contents
   * page, a list of links, a stub with a heading and two lines. Filler is
   * worse than a shorter quiz: a question invented about a table of numbers
   * gets marked against an answer nobody wrote.
   */
  nothing_in_it: z.boolean().default(false),
});

export type QuizChunkPayload = z.infer<typeof quizChunkSchema>;

/** How many questions a quiz aims at, across all of its material. */
export const QUIZ_QUESTIONS = 10;

/**
 * The fewest a quiz is worth starting with.
 *
 * Not ten, because a dropped question should cost that question rather than
 * the quiz. Below three there is nothing to work through.
 */
export const MIN_QUIZ_QUESTIONS = 3;
