/**
 * The page's own heading.
 *
 * Node rather than string on both fields: the role page puts an editable input
 * in the title, and several pages put a company link in the subtitle. There
 * were two of these components differing only in that, which is not a reason
 * for two components.
 *
 * The bottom margin lives here. A page that adds its own is fighting the one
 * thing this exists to make consistent.
 *
 * `leading` is the mark that belongs to the thing the page is about -- a
 * company's logo, so far. It sits outside the title rather than inside it
 * because an image inside an h1 is part of the heading text as far as a screen
 * reader is concerned, and the mark is decoration for a name that is already
 * being read out.
 */
export function PageHeader({
  title,
  description,
  actions,
  leading,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  leading?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      {leading}
      <div className="min-w-0">
        <h1 className="font-display text-title tracking-tight text-ink">{title}</h1>
        {description && <p className="mt-0.5 text-body text-ink-muted">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
