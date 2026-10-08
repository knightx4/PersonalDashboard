import { cn } from '@/lib/cn';

/**
 * The columns every row shares.
 *
 * One template, used by the header and by every row at every depth, is what
 * makes the page scan: the status of a sub-sub-step sits under the status of
 * the feature above it, because the indent lives inside the name cell rather
 * than around the row. On a phone the priority and step count go and the
 * name, the status, the assignee circle and the menu stay, and the name wraps
 * rather than truncating (tree-row.tsx). The status there is its glyph alone,
 * with the word kept for screen readers.
 *
 * Status is one column: the health word, saying who or what it waits on when
 * that is more than the word alone. Who holds the step is the circle after it,
 * your photo or Dash's visor, so "how far along, and who has it" reads as one
 * glance across two cells rather than two words that often repeated each
 * other ("Waiting on you", "On you").
 */
// The last column holds the row's quick actions as well as its menu, so it is
// wide enough for them from sm up -- reserved rather than grown on hover,
// because a column that widens under the pointer moves every row beside it.
export const ROW_GRID =
  'grid grid-cols-[minmax(0,1fr)_2rem_1.75rem_2rem] items-center gap-x-2 ' +
  'sm:grid-cols-[minmax(0,1fr)_9.5rem_2.25rem_5.5rem_6rem_8rem]';

/** The width of one level of the tree, in the name cell. */
export const LEVEL = 'w-5';

/**
 * The labels over the columns. `priority` names the fourth, which a page
 * other than the plan may fill with something of its own: a goal's dates.
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
      <span className="hidden sm:block">Status</span>
      <span className="sm:hidden" />
      <span />
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
