import { z } from 'zod';
import type { FigureKind } from '../types';
import { FigureGrid } from './grid';

/** A table: named columns and rows of cells, for an idea that quantifies or orders (plan #2321.1). */

export const MAX_TABLE_COLUMNS = 5;
export const MAX_TABLE_ROWS = 8;
const MAX_CELL_CHARS = 80;

const cell = z.string().trim().min(1).max(MAX_CELL_CHARS);

const tableSpec = z
  .object({
    columns: z.array(cell).min(2).max(MAX_TABLE_COLUMNS),
    rows: z.array(z.array(z.string().trim().max(MAX_CELL_CHARS))).min(1).max(MAX_TABLE_ROWS),
  })
  .refine((spec) => spec.rows.every((row) => row.length === spec.columns.length), {
    message: 'Every row has one cell per column.',
    path: ['rows'],
  });

export type TableSpec = z.infer<typeof tableSpec>;

export const tableKind: FigureKind<TableSpec> = {
  id: 'table',
  label: 'Table',
  schema: tableSpec,
  writerLine: `table: rows and named columns, for an idea that quantifies or orders: figures before and after a change, a ranking, a worked calculation laid out step by step. spec is {"columns": [2 to ${MAX_TABLE_COLUMNS} column names], "rows": [1 to ${MAX_TABLE_ROWS} rows, each a list with one short cell per column]}. Put units in the column names or the cells. Only figures you are sure of.`,
  example: {
    caption: 'A café’s takings before and after it raises the price of a flat white.',
    spec: {
      columns: ['Price', 'Cups a day', 'Takings'],
      rows: [
        ['£3.20', '100', '£320'],
        ['£3.60', '90', '£324'],
      ],
    },
  },
  Render: ({ spec }) => <FigureGrid head={spec.columns} rows={spec.rows} />,
  data: 'none',
};
