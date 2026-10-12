/**
 * The main-plus-rail pattern (docs/UI-QUALITY-SPEC.md, Part 4): an overview
 * page with the column you work in and, from laptop width, a narrow column on
 * the right holding what you glance at beside it. Home is the first page on
 * it (plan #1627).
 *
 * Two slots and no options, for the reason `DetailLayout`
 * (components/shell/detail-layout.tsx) gives: a layout that starts taking a
 * prop per page is a worse version of writing the markup twice. A page that
 * wants the rail somewhere else, or a third column, is a different pattern.
 *
 * Each slot is rendered once. Below lg the grid is one column and the rail
 * follows the main column in the order of the markup; from lg the same two
 * elements sit side by side. Drawing a slot twice and hiding one copy per
 * width would give its sections two of every id, and an anchor such as
 * /home#watching would land on whichever came first, hidden or not.
 *
 * The pair is max-w-6xl (1152px) at most, so the main column keeps about the
 * reading width a one-column overview has (max-w-3xl) with the 18rem rail
 * beside it, and below lg the one column is held to that reading width.
 *
 * The rail is not sticky. What goes in it (what Dash is watching, what it did
 * today, the week) is often taller than the screen, and a sticky column
 * taller than the screen cannot be scrolled to its foot until the page ends.
 * It scrolls with the page.
 *
 * The rail holds what you glance at: counts, what is running, what Dash did,
 * what is due soon. Never the thing you came to the page to act on, and never
 * on a detail page, which stays one column (taste `one-column-detail`).
 */
export function MainRail({
  main,
  rail,
}: {
  /** The column you work in: the header, then what the page is for. */
  main: React.ReactNode;
  /** What you glance at beside it, as a stack of sections. */
  rail: React.ReactNode;
}) {
  return (
    <div className="mx-auto grid w-full max-w-3xl grid-cols-1 gap-y-10 lg:max-w-6xl lg:grid-cols-[minmax(0,1fr)_18rem] lg:gap-x-8">
      <div className="min-w-0">{main}</div>
      <aside aria-label="At a glance" className="flex min-w-0 flex-col gap-4">
        {rail}
      </aside>
    </div>
  );
}
