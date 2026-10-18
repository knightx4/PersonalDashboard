import type { ExplorableModel } from './types';
import { supplyDemandModel } from './supply-demand';

/**
 * Every explorable model a lesson can name (plan #2321.7), listed by field
 * for the lesson writer. A model is added by appending it here; see
 * `./types.ts` for what else it needs.
 */

export const EXPLORABLE_MODELS: readonly ExplorableModel[] = [
  supplyDemandModel,
];

export function explorableModel(id: string): ExplorableModel | null {
  return EXPLORABLE_MODELS.find((model) => model.id === id) ?? null;
}

/** The models' ids, for the explorable kind's schema. */
export function explorableModelIds(): [string, ...string[]] {
  return EXPLORABLE_MODELS.map((model) => model.id) as [string, ...string[]];
}

/** The models by field, one line each, for the writer: id, what it shows, its parameters and their ranges. */
export function explorableWriterList(): string {
  const fields = [...new Set(EXPLORABLE_MODELS.map((model) => model.field))];
  return fields
    .map((field) => {
      const models = EXPLORABLE_MODELS.filter((model) => model.field === field).map((model) => {
        const params = model.params
          .map((param) => `"${param.id}" from ${param.min} to ${param.max} in steps of ${param.step}, starting at ${param.start}`)
          .join('; ');
        return `"${model.id}", ${model.teaches} Parameters: ${params}.`;
      });
      return `${field}: ${models.join(' ')}`;
    })
    .join(' ');
}
