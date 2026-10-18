import { z } from 'zod';
import type { FigureKind } from '../types';
import { FigureGrid } from './grid';

/**
 * A comparison: two or three things side by side on named rows, for an idea
 * that compares (plan #2321.1). Drawn as a grid with the things as columns
 * and the rows' names in the first column.
 */

export const MAX_COMPARE_THINGS = 3;
export const MAX_COMPARE_ROWS = 6;
const MAX_CELL_CHARS = 80;

const text = z.string().trim().min(1).max(MAX_CELL_CHARS);

const compareSpec = z
  .object({
    things: z.array(text).min(2).max(MAX_COMPARE_THINGS),
    rows: z
      .array(z.object({ label: text, values: z.array(z.string().trim().max(MAX_CELL_CHARS)) }))
      .min(2)
      .max(MAX_COMPARE_ROWS),
  })
  .refine((spec) => spec.rows.every((row) => row.values.length === spec.things.length), {
    message: 'Every row has one value per thing.',
    path: ['rows'],
  });

export type CompareSpec = z.infer<typeof compareSpec>;

export const compareKind: FigureKind<CompareSpec> = {
  id: 'compare',
  label: 'Comparison',
  schema: compareSpec,
  writerLine: `compare: two or three things side by side on the same named rows, for an idea that compares: two policies, two cases, a market before and after. spec is {"things": [2 to ${MAX_COMPARE_THINGS} names], "rows": [2 to ${MAX_COMPARE_ROWS} of {"label": what the row measures, "values": [one short value per thing, in the order of things]}]}.`,
  example: {
    caption: 'How buyers of petrol and of one café’s coffee react to the same 10% price rise.',
    spec: {
      things: ['Petrol', 'One café’s coffee'],
      rows: [
        { label: 'Fall in what is bought', values: ['About 2%', 'About 25%'] },
        { label: 'Demand is', values: ['Inelastic', 'Elastic'] },
        { label: 'Takings', values: ['Rise', 'Fall'] },
      ],
    },
  },
  Render: ({ spec }) => (
    <FigureGrid head={['', ...spec.things]} rows={spec.rows.map((row) => [row.label, ...row.values])} labelled />
  ),
  data: 'none',
};
