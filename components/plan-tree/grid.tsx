import { cn } from '@/lib/cn';

/**
 * The columns every row shares.
 *
 * One template, used by the header and by every row at every depth, is what
 * makes the page scan: the health of a sub-sub-step sits under the health of
 * the feature above it, because the indent lives inside the name cell rather
 * than around the row. On a phone the three middle columns go and the name,
 * the health and the menu stay, and the name wraps rather than truncating
 * (tree-row.tsx). The health there is its glyph alone, with the word kept for
 * screen readers: at 390 pixels the word's column left a title three lines
 * tall.
 */
// The last column holds the row's quick actions as well as its menu, so it is
// wide enough for them from sm up -- reserved rather than grown on hover,
// because a column that widens under the pointer moves every row beside it.
// Status sits directly after Health, because the two are read together -- "how
// far along, and who has it" is one question asked twice -- and a column
// between them would make that a comparison across the row.
export const ROW_GRID =
  'grid grid-cols-[minmax(0,1fr)_2rem_2rem] items-center gap-x-2 ' +
  'sm:grid-cols-[minmax(0,1fr)_7.25rem_6rem_5.5rem_6rem_8rem]';

/** The width of one level of the tree, in the name cell. */
export const LEVEL = 'w-5';

/**
 * The labels over the columns. `priority` names the fourth column, which a
 * page other than the plan may fill with something of its own.
 */
export function ColumnHeader({ priority = 'Priority' }: { priority?: string } = {}) {
  return (
    <li
      aria-hidden
      className={cn(
        ROW_GRID,
        'px-3 py-1.5 text-micro font-semibold uppercase tracking-wide text-ink-ghost',
      )}
    >
      <span>Step</span>
      <span className="hidden sm:block">Health</span>
      <span className="sm:hidden" />
      <span className="hidden sm:block">Status</span>
      <span className="hidden sm:block">{priority}</span>
      <span className="hidden sm:block">Steps</span>
      <span />
    </li>
  );
}

/**
 * The lines that draw the tree.
 *
 * One slot per level above this row. An outer slot carries the line down
 * from an ancestor that still has siblings after it; the innermost slot is
 * the elbow into this row, continuing below when a sibling follows. It is
 * what lets a step three deep be read as three deep at a glance, without the
 * indent alone having to say so.
 */
export function TreeGuides({ trail }: { trail: readonly boolean[] }) {
  return (
    <>
      {trail.map((continues, level) => {
        const last = level === trail.length - 1;
        return (
          <span key={level} className={cn(LEVEL, 'relative shrink-0 self-stretch')} aria-hidden>
            {(continues || last) && (
              <span
                className={cn(
                  'absolute left-2 top-0 w-px bg-border-strong',
                  continues ? 'bottom-0' : 'h-1/2',
                )}
              />
            )}
            {last && <span className="absolute left-2 top-1/2 h-px w-2.5 bg-border-strong" />}
          </span>
        );
      })}
    </>
  );
}
