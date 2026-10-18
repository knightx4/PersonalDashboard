import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { cn } from '@/lib/cn';
import { BLANK_CELL } from '../questions/fill-cell';

/**
 * The grid the table and compare kinds both draw (plan #2321.1): a header
 * row, then rows of cells, numbers right-aligned in a column that holds only
 * numbers. It does not stack on a phone, since a figure is a grid to be read
 * across, and it scrolls with a fade only when it has more than three
 * columns.
 */

/** A value this short stays on one line ("About 25%", "£3.60"). */
const SHORT_VALUE_CHARS = 16;

const NUMBER_LIKE =/^[-+(]?[$£€]?[\d.,]+%?[)]?[kmb]?$/i;

/** Whether every non-empty cell of each column reads as a number. A question's blank (plan #2321.5) is neither. */
export function numericColumns(rows: readonly (readonly string[])[], width: number): boolean[] {
  return Array.from({ length: width }, (_, index) =>
    rows.every((row) => {
      const cell = row[index] ?? '';
      return cell === '' || cell === BLANK_CELL || NUMBER_LIKE.test(cell.replace(/\s/g, ''));
    }),
  );
}

export function FigureGrid({
  head,
  rows,
  labelled = false,
}: {
  head: readonly string[];
  rows: readonly (readonly string[])[];
  /** The first cell of each row names it (compare's row labels). */
  labelled?: boolean;
}) {
  const numeric = numericColumns(rows, head.length);
  return (
    <Table stack={false} flush fit={head.length <= 3}>
      <THead>
        <tr>
          {head.map((column, index) => (
            <TH key={index} num={index > 0 && numeric[index]}>
              {column}
            </TH>
          ))}
        </tr>
      </THead>
      <TBody>
        {rows.map((row, rowIndex) => (
          <TR key={rowIndex}>
            {row.map((cell, index) => (
              <TD
                key={index}
                num={index > 0 && numeric[index]}
                muted={labelled && index === 0}
                // A short value is read whole, so it never breaks; the
                // row's label or a longer value wraps instead.
                className={cn(!(labelled && index === 0) && cell.length <= SHORT_VALUE_CHARS && 'whitespace-nowrap')}
              >
                {cell}
              </TD>
            ))}
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
