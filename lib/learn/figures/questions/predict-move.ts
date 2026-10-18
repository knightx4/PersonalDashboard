import { z } from 'zod';
import { explorableModel } from '../models/registry';
import { onScale, startingValues, type ModelValues } from '../models/types';
import type { FigureQuestionForm } from '../types';

/**
 * Predict the move (plan #2321.8): an explorable model drawn still, where the
 * lesson starts it, with a change to one or more of its sliders described,
 * and a pick of which way one of the numbers it works out goes. The chart
 * kind's predict_direction reads a fetched series; this one reads the model,
 * so the answer comes from the model's own arithmetic and never from the
 * writer.
 *
 * The figure is drawn without its sliders, since moving them would show the
 * answer. A move whose effect is too small to call is not asked.
 */

export type Move = 'up' | 'down' | 'same';

const askSchema = z.object({
  /** The sliders' new values, by parameter id. */
  move: z.record(z.string(), z.number()),
  /** The model's measure the question asks about. */
  measure: z.string().trim().min(1).max(40),
  /** The change in words, as it happens in the world: "A new rail line opens, running 15 km out from the centre." */
  change: z.string().trim().min(10).max(200),
});

export type PredictMoveAsk = z.infer<typeof askSchema>;

/** At most this share of the start is "the same". */
const SAME_SHARE = 0.005;
/** At least this share is a move. Between the two the question is not asked. */
const MOVED_SHARE = 0.02;

/** Which way a number went, or null when the move is too small to call. */
export function moveOf(from: number, to: number): Move | null {
  const share = Math.abs(to - from) / Math.max(Math.abs(from), 1e-9);
  if (share <= SAME_SHARE) return 'same';
  if (share < MOVED_SHARE) return null;
  return to > from ? 'up' : 'down';
}

type ExplorableSpecShape = { model: string; start: ModelValues; still?: boolean };

export function predictMoveForm<Spec extends ExplorableSpecShape>(): FigureQuestionForm<
  Spec,
  unknown,
  PredictMoveAsk
> {
  return {
    id: 'predict_move',
    label: 'Which way it moves',
    writerLine:
      'predict_move: the model drawn still where the spec starts it, a change to its sliders described, and a pick of which way one of its measures goes, for a level whose checks are about what follows from a change: rents after a new line, a price after a bad harvest. ask is {"move": {a parameter\'s id: its new value, on its scale, for each slider the change moves}, "measure": the id of one of the model\'s measures, "change": one sentence saying what happens in the world, without saying what it does to the measure, such as "A new rail line opens, running 15 km out from the centre."}. You never write the answer: it is worked out by the model, and a move too small to call is not asked.',
    schema: askSchema,
    pose({ spec, ask }) {
      const model = explorableModel(spec.model);
      const measure = model?.measures.find((one) => one.id === ask.measure);
      if (!model || !measure) return null;
      const from = startingValues(model, spec.start);
      for (const [id, value] of Object.entries(ask.move)) {
        const param = model.params.find((one) => one.id === id);
        if (!param || !onScale(param, value)) return null;
      }
      const to = { ...from, ...ask.move };
      if (model.params.every((param) => to[param.id] === from[param.id])) return null;
      const answer = moveOf(measure.at(from), measure.at(to));
      if (!answer) return null;
      const words = measure.words ?? {
        up: 'It rises',
        down: 'It falls',
        same: 'It stays the same',
      };
      const prompt = `${ask.change.replace(/\s*$/, '')} What happens to ${measure.label}?`;
      return {
        spec: { ...spec, start: from, still: true },
        prompt: prompt.charAt(0).toUpperCase() + prompt.slice(1),
        choices: [
          { value: 'up', label: words.up },
          { value: 'down', label: words.down },
          { value: 'same', label: words.same },
        ],
        answer,
      };
    },
    grade: (answer, response) => (response === answer ? 'met' : 'not_met'),
    example: {
      move: { supply: -20 },
      measure: 'price',
      change: 'A frost cuts the coffee harvest.',
    },
  };
}
