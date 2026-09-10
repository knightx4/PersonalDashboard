import { cn } from '@/lib/cn';

/**
 * A detail page: the thing itself on the left, its properties in a column on
 * the right, and what has happened to it underneath.
 *
 * A component rather than a shape each page copies, which is #163's answer:
 * the role page and the order page are both moved onto it, so a change to the
 * arrangement is one edit rather than a hunt. It stays a layout and holds no
 * content of its own -- three slots, no options -- because the moment it
 * starts taking a prop per page it is a worse version of writing the markup
 * twice.
 *
 * The order on a phone is header, properties, then the body, which is why the
 * three are siblings in one grid rather than the body being nested under the
 * header: a page's facts are what you came for, and burying them under a
 * timeline is the arrangement this replaces.
 */
export function DetailLayout({
  header,
  properties,
  children,
  className,
}: {
  /** The page header: what this is, and the actions that belong to it. */
  header: React.ReactNode;
  /** The facts about it. `PropertyList` and `Property` below draw them. */
  properties: React.ReactNode;
  /** Everything that happened: panels, timelines, tables, notes. */
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'grid grid-cols-1 gap-x-6 gap-y-4 lg:grid-cols-[minmax(0,1fr)_15rem]',
        className,
      )}
    >
      <div className="lg:col-start-1 lg:row-start-1">{header}</div>
      <aside
        aria-label="Properties"
        // Sticky from lg, the same offset the filter rail uses: the facts are
        // what a long timeline is read against, so they should not scroll away
        // from it.
        className="lg:sticky lg:top-20 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-start"
      >
        {properties}
      </aside>
      <div className="lg:col-start-1 lg:row-start-2">{children}</div>
    </div>
  );
}

/**
 * The facts, two across on a phone and a column in the rail from lg up.
 *
 * No card. A property is a label and a value, and eight of them in a bordered
 * grid is law 11's hand-rolled box with a `dl` inside it -- which is what both
 * pages had.
 */
export function PropertyList({ children }: { children: React.ReactNode }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4 lg:grid-cols-1 lg:gap-y-2.5">
      {children}
    </dl>
  );
}

/** One fact: what it is, then what it says. */
export function Property({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  /** The `title` on the value, for a fact that needs a sentence of context. */
  hint?: string;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-micro uppercase tracking-wider text-ink-muted">{label}</dt>
      <dd className="tabular mt-0.5 truncate text-ui text-ink" title={hint}>
        {value}
      </dd>
    </div>
  );
}
