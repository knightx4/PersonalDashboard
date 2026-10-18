import { z } from 'zod';
import type { FigureKind } from '../types';

/**
 * A figure the app cannot draw yet (plan #2321.9).
 *
 * When an idea needs a kind of figure, a data source, a model or a map layer
 * that no registered kind provides, the writer says so with a wanted block
 * instead of doing without or forcing a kind that does not fit. The block is
 * stored on the lesson like any figure and drawn as its caption with a line
 * saying it is not built yet; the lesson writer also records it in
 * learn.figure_needs (`../needs.ts`), grouped with the other lessons asking
 * for the same thing.
 */

export const FIGURE_NEEDS = ['figure_kind', 'data_source', 'model', 'map_layer'] as const;
export type FigureNeed = (typeof FIGURE_NEEDS)[number];

const MAX_LINE_CHARS = 200;

const line = z.string().trim().min(1).max(MAX_LINE_CHARS);

const wantedSpec = z.object({
  need: z.enum(FIGURE_NEEDS),
  shows: line,
  why: line,
});

export type WantedSpec = z.infer<typeof wantedSpec>;

export const NOT_BUILT_LINE = 'This figure is not built yet.';

export const wantedKind: FigureKind<WantedSpec> = {
  id: 'wanted',
  label: 'Not built yet',
  schema: wantedSpec,
  writerLine: `wanted: when the idea plainly needs a figure that none of the kinds above can draw, because the app lacks the kind of figure, the data source, the model or the map layer it would take. Use it rather than a kind that does not fit, and never when one of the kinds above would do. spec is {"need": one of "figure_kind", "data_source", "model", "map_layer", "shows": one line on what the figure would show, naming the data or the model it needs, "why": one line on why prose is worse here}. caption is the sentence the figure would carry. The lesson shows the caption and says the figure is not built yet.`,
  example: {
    caption: 'How a café’s takings change as it moves the price, for buyers who barely react and buyers who walk away.',
    spec: {
      need: 'model',
      shows: 'A demand curve with a price slider, shading takings as price times cups, with a control for how strongly buyers react.',
      why: 'The idea is that takings rise or fall depending on the slope; watching the shaded area grow or shrink shows it where two numbers only state it.',
    },
  },
  Render: () => <p className="mt-0.5 text-small text-ink-muted">{NOT_BUILT_LINE}</p>,
  data: 'wanted',
};
