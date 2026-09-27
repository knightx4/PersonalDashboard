/**
 * One section of the Jobs home: a heading, an optional hint, and what goes
 * under it.
 *
 * Every section on Home goes through this, so the page reads as one column of
 * the same kind of block and a new section is a new child of the page rather
 * than a new layout. The heading is an h2 under the page's h1; anything a
 * section lists inside its own cards is headed h3.
 */
export function HomeSection({
  id,
  title,
  hint,
  children,
}: {
  /** Makes the heading id, `<id>-heading`, which labels the section. */
  id: string;
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  const headingId = `${id}-heading`;
  return (
    <section aria-labelledby={headingId} className="space-y-2">
      <header className="flex flex-wrap items-baseline gap-x-2 px-1">
        <h2 id={headingId} className="text-ui font-semibold text-ink">
          {title}
        </h2>
        {hint && <span className="text-small text-ink-muted">{hint}</span>}
      </header>
      {children}
    </section>
  );
}
