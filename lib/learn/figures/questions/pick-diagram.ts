import { z } from 'zod';
import type { FigureQuestionForm } from '../types';

/**
 * Pick the diagram (plan #2321.5): the right diagram of a process beside two
 * or three that are wrong in one telling way each, and a pick of the right
 * one. Any kind can carry it, since the options are drawn by the kind's own
 * Render: the diagram kinds of plan #2321.2 list `pickDiagramForm(schema)`
 * in their `questions`.
 *
 * The writer writes the right diagram as the figure's spec and the wrong ones
 * in `ask`; the order they are shown in is fixed from their content, so the
 * right one is not always first and the same question always shows the same
 * order.
 */

const LETTERS = ['A', 'B', 'C', 'D'] as const;

export type PickDiagramAsk<Spec> = { prompt: string; wrong: Spec[] };

/** A small stable hash of a string, for an order that does not move between loads. */
function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Where the right diagram goes among `count`, fixed by the question's content. */
export function rightPlace(key: string, count: number): number {
  return hash(key) % count;
}

/**
 * The form for a kind whose specs `spec` parses: one line in the kind's
 * `questions`. `example` is an ask on the kind's own example, wrong in the
 * ways the writer is told to be; `noun` is what an option is called.
 */
export function pickDiagramForm<Spec>(
  spec: z.ZodType<Spec>,
  example?: PickDiagramAsk<Spec>,
  noun = 'diagram',
): FigureQuestionForm<Spec, unknown, PickDiagramAsk<Spec>> {
  const schema = z.object({
    prompt: z.string().trim().min(10).max(300),
    wrong: z.array(spec).min(2).max(LETTERS.length - 1),
  }) as unknown as z.ZodType<PickDiagramAsk<Spec>>;
  const Noun = noun.charAt(0).toUpperCase() + noun.slice(1);
  return {
    id: 'pick_diagram',
    label: `Pick the ${noun}`,
    writerLine: `pick_diagram: the right ${noun} beside two or three wrong ones, for a level whose checks are about how the parts of a process connect or what order they come in. The figure's spec is the right one. ask is {"prompt": one sentence asking which ${noun} shows the thing named, "wrong": [2 or 3 specs of the same kind, each wrong in one way a person who half knows it would believe: two steps swapped, a link reversed, a step missing]}. Keep the labels the same across them, so the pick is about the shape and not the words.`,
    schema,
    pose({ spec: right, ask }) {
      const options = [...ask.wrong];
      const key = JSON.stringify([right, ask.wrong]);
      const at = rightPlace(key, options.length + 1);
      options.splice(at, 0, right);
      const seen = new Set(options.map((option) => JSON.stringify(option)));
      if (seen.size !== options.length) return null;
      return {
        spec: right,
        prompt: ask.prompt,
        choices: options.map((option, index) => ({ value: LETTERS[index], label: `${Noun} ${LETTERS[index]}`, spec: option })),
        answer: LETTERS[at],
      };
    },
    grade: (answer, response) => (response === answer ? 'met' : 'not_met'),
    example,
  };
}
