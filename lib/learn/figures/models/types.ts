import type { ComponentType } from 'react';

/**
 * The explorable model contract (plan #2321.7).
 *
 * Some ideas are learned by moving them: a curve shifted with a slider, its
 * new crossing read off as it moves. Each such model is built once and reused
 * by every lesson that teaches the mechanism. A model names its parameters,
 * each with a range, a step and a starting value, says in a sentence what the
 * current values mean against where they started, and draws them.
 *
 * Every model is one entry in `EXPLORABLE_MODELS` (`./registry.ts`), and the
 * explorable figure kind (`../kinds/explorable.tsx`) names one by id with its
 * starting values. A lesson can name only a model in the registry.
 *
 * Adding a model is one file here, one line appended to `EXPLORABLE_MODELS`,
 * and a gallery surface named `learn-figure-explorable-<id>` (underscores as hyphens)
 * (`modelSurface`) with its route; `./registry.test.tsx` holds every model to
 * its parameters and its surface.
 */

/** A model's values by parameter id. */
export type ModelValues = Record<string, number>;

export type ModelParam = {
  id: string;
  /** What the slider is labelled. */
  label: string;
  min: number;
  max: number;
  step: number;
  /** Where the slider starts when a lesson names none. Between min and max, on a step. */
  start: number;
  /**
   * The value in words against where it started ("Moved right by 10"), shown
   * beside the slider and read out as its aria-valuetext.
   */
  say: (value: number, from: number) => string;
};

/** One number read off the model, with what it was at the start. */
export type ModelReadout = { label: string; value: string; was: string | null };

/** What a model's Plot is given. */
export type ModelPlotProps = {
  values: ModelValues;
  /** The values the lesson started at, drawn faint once the curves have moved. */
  from: ModelValues;
  /** False when the person has asked for reduced motion: the curves jump rather than slide. */
  animate: boolean;
};

export type ExplorableModel = {
  /** Stored in the figure's spec; never renamed once used. */
  id: string;
  /** The field it belongs to, as the writer reads the list. */
  field: string;
  /** What the model is called on the page and in the gallery. */
  label: string;
  /** One sentence for the lesson writer: the mechanism it shows and what moving it teaches. */
  teaches: string;
  params: readonly ModelParam[];
  /** The live caption: what the current values mean against where they started. */
  describe: (values: ModelValues, from: ModelValues) => string;
  /** The numbers to read off, beside the plot. */
  readouts: (values: ModelValues, from: ModelValues) => ModelReadout[];
  /**
   * The model's numbers as a grid, for screen readers: recharts draws
   * nothing on the server, and a curve is not read out.
   */
  table: (values: ModelValues) => { head: string[]; rows: string[][] };
  /** The drawing, on the client. */
  Plot: ComponentType<ModelPlotProps>;
  /**
   * The model drawn moved, on its gallery surface: a lesson's caption, where
   * it starts, and where the sliders have been moved to, so the surface shows
   * the live caption and the faint starting curves.
   */
  example: { caption: string; start: ModelValues; moved: ModelValues };
};

/**
 * The gallery surface every model is drawn on. Surface ids take hyphens only
 * (`lib/preview/ui-checks.ts`), so `supply_demand` is drawn on
 * `learn-figure-explorable-supply-demand`.
 */
export function modelSurface(model: Pick<ExplorableModel, 'id'>): string {
  return `learn-figure-explorable-${model.id.replace(/_/g, '-')}`;
}

/** Each parameter's starting value, with any the lesson named in place of the model's own. */
export function startingValues(model: ExplorableModel, named: ModelValues = {}): ModelValues {
  return Object.fromEntries(model.params.map((param) => [param.id, named[param.id] ?? param.start]));
}

/** Whether a value is in a parameter's range and on one of its steps. */
export function onScale(param: ModelParam, value: number): boolean {
  if (!Number.isFinite(value) || value < param.min || value > param.max) return false;
  const steps = (value - param.min) / param.step;
  return Math.abs(steps - Math.round(steps)) < 1e-9;
}
