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
 *
 * `bulk` is the page's own verbs for a selection -- Confirm 4 orders, Dismiss
 * 2 emails. It is rendered by SelectionActionBar, which draws nothing at all
 * while nothing is selected and takes the header's place when something is.
 * The bar sits over the heading rather than above or below it, so a selection
 * never moves the page: both are in the same grid cell, the heading keeps its
 * space and goes invisible while the bar is up. The cell is as tall as the
 * taller of the two, so a bar that wraps on a phone grows the header instead
 * of spilling over the list.
 *
 * The actions are pushed right by an auto margin rather than by
 * `justify-between`. Justification only distributes space between items that
 * share a line, so on a narrow screen -- where a header carrying a mark, a long
 * title and three actions wraps -- the actions landed alone on the second line
 * and sat flush left. An auto margin travels with them onto whichever line they
 * end up on. It also keeps the mark and the title next to each other instead of
 * letting justification push them to opposite ends of a wide header.
 *
 * The actions wrap among themselves too. Three buttons are wider than a phone,
 * and without the wrap they squeezed each other until their labels broke onto
 * two lines inside a button one line tall (seen on a newsletter, plan #788).
 */
export function PageHeader({
  title,
  description,
  actions,
  leading,
  bulk,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  leading?: React.ReactNode;
  /** What can be done to a selection, wrapped in SelectionActionBar. */
  bulk?: React.ReactNode;
}) {
  return (
    <div className="group/header mb-5 grid">
      <div className="col-start-1 row-start-1 flex flex-wrap items-start gap-3 group-has-[[data-selection-bar]]/header:invisible">
        {leading}
        <div className="min-w-0">
          <h1 className="font-display text-title tracking-tight text-ink">{title}</h1>
          {description && <p className="mt-0.5 text-body text-ink-muted">{description}</p>}
        </div>
        {actions && (
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">{actions}</div>
        )}
      </div>
      {bulk}
    </div>
  );
}
