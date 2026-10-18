import { z } from 'zod';
import type { FigureKind } from '../types';
import { explorableModel, explorableModelIds, explorableWriterList } from '../models/registry';
import { onScale, type ModelValues } from '../models/types';
import { ExplorableView } from './explorable-view';
import { predictMoveForm } from '../questions/predict-move';

/**
 * An explorable model (plan #2321.7): a mechanism drawn with sliders the
 * person moves, from the model registry (`../models/registry.ts`). The block
 * names the model and, where the lesson wants somewhere other than the
 * model's own start, the parameters' starting values.
 *
 * A model the registry lacks does not parse, so the writer's figure is left
 * off and a stored one shows its caption alone until the model is built.
 */

const explorableSpec = z
  .object({
    model: z.enum(explorableModelIds()),
    start: z.record(z.string(), z.number()).default({}),
    /** Drawn without its sliders, as a question asking what moving them would do shows it (plan #2321.8). */
    still: z.boolean().optional(),
  })
  .superRefine((spec, context) => {
    const model = explorableModel(spec.model);
    if (!model) return;
    for (const [id, value] of Object.entries(spec.start)) {
      const param = model.params.find((one) => one.id === id);
      if (!param) context.addIssue({ code: 'custom', message: `${model.id} has no parameter ${id}.`, path: ['start', id] });
      else if (!onScale(param, value))
        context.addIssue({
          code: 'custom',
          message: `${id} runs from ${param.min} to ${param.max} in steps of ${param.step}.`,
          path: ['start', id],
        });
    }
  });

export type ExplorableSpec = { model: string; start: ModelValues; still?: boolean };

export const explorableKind: FigureKind<ExplorableSpec> = {
  id: 'explorable',
  label: 'Explorable model',
  schema: explorableSpec as unknown as z.ZodType<ExplorableSpec>,
  writerLine: `explorable: a model the reader moves with sliders, for an idea about a mechanism one of the models below draws, where moving it teaches more than a still picture. Name only a model listed here; when none draws the idea, choose another kind or no figure. spec is {"model": the model's id, "start": {a parameter's id: its starting value, for any that should not start at the model's own}}; leave start empty unless the lesson sets the scene somewhere particular. The caption says what to try ("Move supply left, as a bad harvest would"). The models, by field: ${explorableWriterList()}`,
  example: {
    caption: 'How a market finds its price: move either curve and read where buyers and sellers now meet.',
    spec: { model: 'supply_demand', start: {} },
  },
  Render: ({ spec }) => <ExplorableView modelId={spec.model} start={spec.start} still={spec.still ?? false} />,
  questions: [predictMoveForm<ExplorableSpec>()],
  data: 'none',
};
