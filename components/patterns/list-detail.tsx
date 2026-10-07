import Link from '@/components/ui/link';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/cn';

/**
 * The list-and-detail pattern (docs/UI-QUALITY-SPEC.md, Part 4): a list you
 * work through, and one item's page.
 *
 * Two pages, because the app's lists and their items are two routes
 * (`/jobs/roles` and `/jobs/roles/[id]`), and each is one column at every
 * width. The rule is on /dev/ui under "Page patterns"
 * (app/dev/ui/patterns.tsx), and the gallery draws both halves as
 * `pattern-list` and `pattern-detail`.
 *
 * These are layouts: they place what they are given and hold no content of
 * their own. A page that needs a slot they do not have is either the rest of
 * the detail page (children) or a sign that it is a different pattern.
 */

/**
 * The list: the page header, then what the list is read through (a search,
 * a row of chips), then one surface of rows, then the count.
 */
export function ListPage({
  header,
  tools,
  children,
  foot,
  className,
}: {
  /** The page header, with the one action the page owns. */
  header: React.ReactNode;
  /** What the list is narrowed by: a search, or chips on one line. */
  tools?: React.ReactNode;
  /** The rows, as `ListRow`s. */
  children: React.ReactNode;
  /** The count, or what the rows add up to. */
  foot?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mx-auto max-w-3xl', className)}>
      {header}
      {tools && <div className="mb-4">{tools}</div>}
      <Card padding="none">
        <ul className="divide-y divide-border">{children}</ul>
      </Card>
      {foot && <div className="mt-3 text-small text-ink-muted">{foot}</div>}
    </div>
  );
}

/**
 * One row of the list. The whole row opens the item: pressing a thing's name
 * opens it and never starts editing it (taste `name-opens-not-edits`).
 */
export function ListRow({
  href,
  title,
  meta,
  end,
}: {
  href: string;
  /** What the item is called. */
  title: string;
  /** One short line after the name: where it came from, what state it is in. */
  meta?: string;
  /** One value at the end of the row, such as a date or an amount. */
  end?: React.ReactNode;
}) {
  return (
    <li>
      <Link
        href={href}
        className="card-pad-x row-pad flex min-h-11 items-center gap-3 hover:bg-sunken"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-ui text-ink">{title}</span>
          {meta && <span className="block truncate text-small text-ink-muted">{meta}</span>}
        </span>
        {end && <span className="tabular shrink-0 text-small text-ink-muted">{end}</span>}
      </Link>
    </li>
  );
}

/**
 * One item's page, one column at every width (taste `one-column-detail`):
 * the header, then the details, then the long text, then the rest.
 *
 * Unlike `DetailLayout` (components/shell/detail-layout.tsx) the details do
 * not move into a column on the right on a laptop. They stay above the text,
 * which is where the person asked for them.
 */
export function DetailPage({
  header,
  details,
  text,
  children,
  className,
}: {
  /** The page header: what this is, and the actions that belong to it. */
  header: React.ReactNode;
  /** The facts about it, as `DetailFacts` holding `Property`s. */
  details: React.ReactNode;
  /** The long text: a description, a posting, a note. Left out when there is none. */
  text?: React.ReactNode;
  /** Everything else: timelines, related rows, the thread. */
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mx-auto max-w-3xl space-y-6', className)}>
      <div>
        {header}
        <section aria-label="Details">{details}</section>
      </div>
      {text}
      {children}
    </div>
  );
}

/**
 * The details as a grid of facts: two across on a phone, four from sm. Takes
 * the `Property` rows from components/shell/detail-layout.tsx.
 */
export function DetailFacts({ children }: { children: React.ReactNode }) {
  return <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">{children}</dl>;
}
