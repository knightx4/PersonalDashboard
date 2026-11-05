import { cn } from '@/lib/cn';

/**
 * Whether a heading's count is drawn. A zero is not (law 1, plan #2966.1): a
 * section with nothing in it should not be on the page, and a "0" beside its
 * heading is the critic's sign that one is (two empty stage boxes each with a
 * 0, a council tab whose second heading carried a 0). Hiding it here means the
 * count cannot be built wrong, rather than every caller remembering to leave
 * it off.
 */
export function countShown(count: React.ReactNode): boolean {
  return count !== undefined && count !== null && count !== false && count !== 0 && count !== '0';
}

/**
 * The heading over a group of things on a page or inside a card: ui size,
 * semibold, the count beside it when there is one, and the action on the
 * same line at the far end.
 *
 * No icon. The card or the space around the group is what groups it; an icon
 * only adds weight to one heading, and on the company page it meant one card
 * had an icon in its heading and the card under it did not. The action is
 * never on a line of its own under the heading.
 */
export function SectionHeading({
  title,
  count,
  action,
  as: Tag = 'h2',
  id,
  className,
}: {
  title: React.ReactNode;
  /** The count or the fact beside the title: "3", "$84". */
  count?: React.ReactNode;
  action?: React.ReactNode;
  as?: 'h2' | 'h3';
  id?: string;
  className?: string;
}) {
  return (
    <div className={cn('flex min-h-8 flex-wrap items-center justify-between gap-x-3 gap-y-1', className)}>
      <Tag id={id} className="min-w-0 text-ui font-semibold text-ink">
        {title}
        {countShown(count) && (
          <span className="tabular ml-2 text-small font-normal text-ink-muted">{count}</span>
        )}
      </Tag>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  );
}

/**
 * The small uppercase label over a field, a value or a group of rows
 * ("Salary", "What they asked", "This week"). Micro, semibold, tracking-wider,
 * muted, with an optional count. Six spellings of this were in use, at three
 * sizes and two trackings.
 *
 * `as` is a paragraph by default; make it a heading (`h2`, `h3`) when it heads
 * a group a screen reader should be able to jump to.
 */
export function SectionLabel({
  children,
  count,
  as: Tag = 'p',
  className,
}: {
  children: React.ReactNode;
  count?: React.ReactNode;
  as?: 'p' | 'h2' | 'h3' | 'h4' | 'h5' | 'dt' | 'span';
  className?: string;
}) {
  return (
    <Tag className={cn('text-micro font-semibold uppercase tracking-wider text-ink-muted', className)}>
      {children}
      {countShown(count) && (
        <span className="tabular ml-2 font-normal normal-case tracking-normal">{count}</span>
      )}
    </Tag>
  );
}
