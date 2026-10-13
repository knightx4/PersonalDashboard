import Link from 'next/link';

/**
 * One section of Today: a heading, an optional hint, an optional link to the
 * page that holds the rest, and what goes under it.
 *
 * Every section on Today goes through this, so the page reads as one column
 * of the same kind of block and a new section is a new child of the page
 * rather than a new layout. The heading is an h2 under the page's h1; anything
 * a section lists inside its own cards is headed h3.
 */
export function HomeSection({
  id,
  title,
  hint,
  more,
  children,
}: {
  /** Makes the heading id, `<id>-heading`, which labels the section. */
  id: string;
  title: string;
  hint?: string;
  /** Where the whole of what this section shows a part of lives. */
  more?: { href: string; label: string };
  children: React.ReactNode;
}) {
  const headingId = `${id}-heading`;
  return (
    <section id={id} aria-labelledby={headingId} className="scroll-mt-4 space-y-2">
      <header className="flex flex-wrap items-baseline gap-x-2 px-1">
        <h2 id={headingId} className="text-ui font-semibold text-ink">
          {title}
        </h2>
        {hint && <span className="text-small text-ink-muted">{hint}</span>}
        {more && (
          <Link
            href={more.href}
            className="press-area ml-auto text-small text-ink-muted transition-colors duration-quick hover:text-accent"
          >
            {more.label}
          </Link>
        )}
      </header>
      {children}
    </section>
  );
}
