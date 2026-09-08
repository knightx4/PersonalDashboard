'use client';

import { createContext, useContext } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/cn';

/**
 * The table.
 *
 * There were eight of these, each hand-built, and they disagreed on header
 * casing, on whether a row lit up under the cursor, and on which sliver of a
 * row was the link. This is the one shape, and the rules it fixes:
 *
 *   - Headers are the small uppercase label, once.
 *   - Numbers are tabular and right-aligned, so a column of them lines up.
 *   - A row with somewhere to go goes there from anywhere in the row. The
 *     first cell holds the link and stretches it over the row, so a middle
 *     click still opens a tab and a screen reader still finds a link.
 *   - A row that can be clicked says so under the cursor.
 *   - On a phone the table does not scroll sideways with half its columns
 *     hidden. Each row stacks into a small card of label/value pairs, with the
 *     header row gone because every value now carries its own label.
 *
 * Row padding derives from the density dial like everything else.
 */
const TableContext = createContext<{ stack: boolean; flush: boolean }>({
  stack: true,
  flush: false,
});
const RowContext = createContext<{ href?: string }>({});

export function Table({
  children,
  className,
  stack = true,
  flush = false,
  ...props
}: React.TableHTMLAttributes<HTMLTableElement> & {
  /**
   * Below md, stack each row into label/value pairs instead of scrolling. On
   * by default; a table that is genuinely a grid -- a calendar, a matrix --
   * sets it off and scrolls with a fade at the edge so the scroll is visible.
   */
  stack?: boolean;
  /** Inside a padded card: the first and last cells meet the card's own padding. */
  flush?: boolean;
}) {
  return (
    <TableContext.Provider value={{ stack, flush }}>
      <div className={cn('overflow-x-auto', !stack && 'max-lg:scroll-fade-x')}>
        <table
          className={cn('w-full border-collapse text-ui', stack && 'max-md:block', className)}
          {...props}
        >
          {children}
        </table>
      </div>
    </TableContext.Provider>
  );
}

export function THead({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  const { stack } = useContext(TableContext);
  return <thead className={cn(stack && 'max-md:hidden', className)} {...props} />;
}

export function TBody({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  const { stack } = useContext(TableContext);
  return (
    <tbody className={cn('divide-y divide-border', stack && 'max-md:block', className)} {...props} />
  );
}

export function TH({
  className,
  num = false,
  children,
  ...props
}: React.ThHTMLAttributes<HTMLTableCellElement> & { num?: boolean }) {
  const { flush } = useContext(TableContext);
  return (
    <th
      scope="col"
      className={cn(
        'row-pad text-left text-micro font-semibold uppercase tracking-wider text-ink-muted',
        flush ? 'px-3 first:pl-0 last:pr-0' : 'px-4',
        num && 'text-right',
        className,
      )}
      {...props}
    >
      {children}
    </th>
  );
}

export function TR({
  href,
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLTableRowElement> & {
  /** Where the whole row goes. Put the visible link in a `TD primary`. */
  href?: string;
}) {
  const { stack } = useContext(TableContext);
  return (
    <RowContext.Provider value={{ href }}>
      <tr
        className={cn(
          'relative transition-colors duration-150',
          href && 'hover:bg-sunken',
          stack && 'max-md:block max-md:py-2',
          className,
        )}
        {...props}
      >
        {children}
      </tr>
    </RowContext.Provider>
  );
}

export function TD({
  className,
  num = false,
  primary = false,
  muted = false,
  label,
  children,
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement> & {
  /** A number: tabular, right-aligned, never wrapped. */
  num?: boolean;
  /** The cell that names the row. Carries the row's link, if it has one. */
  primary?: boolean;
  muted?: boolean;
  /** What this column is called, for the stacked phone layout. */
  label?: string;
}) {
  const { stack, flush } = useContext(TableContext);
  const { href } = useContext(RowContext);

  const body =
    primary && href ? (
      <Link
        href={href}
        className="font-medium text-ink after:absolute after:inset-0 after:content-[''] hover:text-accent"
      >
        {children}
      </Link>
    ) : (
      children
    );

  return (
    <td
      data-label={label}
      className={cn(
        'row-pad align-top',
        flush ? 'px-3 first:pl-0 last:pr-0' : 'px-4',
        muted ? 'text-ink-muted' : 'text-ink',
        primary && 'font-medium',
        num && 'tabular whitespace-nowrap text-right',
        stack &&
          'max-md:flex max-md:items-baseline max-md:justify-between max-md:gap-3 max-md:py-0.5 max-md:text-right',
        stack &&
          label &&
          !primary &&
          "max-md:before:shrink-0 max-md:before:text-left max-md:before:text-ink-muted max-md:before:content-[attr(data-label)]",
        stack && primary && 'max-md:justify-start max-md:text-left max-md:text-body',
        className,
      )}
      {...props}
    >
      {body}
    </td>
  );
}
