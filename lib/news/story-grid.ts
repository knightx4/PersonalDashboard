/*
 * Where each story sits in the News grid (plan #940), apart from the component
 * so it can be tested without rendering. One column below md, two from md,
 * three from lg.
 */

export type GridSpan = { md: 1 | 2; lg: 1 | 2 | 3; tall: boolean };

/**
 * Where each card sits, worked out from the count so no row ends with an
 * empty cell. The lead takes two columns and, when two stories can stand
 * beside it, two rows on a laptop. The last card of a row that would come up
 * short is widened to fill it.
 */
export function gridSpans(count: number): GridSpan[] {
  const spans: GridSpan[] = Array.from({ length: count }, () => ({ md: 1, lg: 1, tall: false }));
  if (count === 0) return spans;
  const rest = count - 1;

  // Two columns from md: the lead is the whole first row, the rest in pairs.
  spans[0].md = 2;
  if (rest % 2 === 1) spans[count - 1].md = 2;

  // Three columns from lg.
  if (rest === 0) {
    spans[0].lg = 3;
  } else if (rest === 1) {
    spans[0].lg = 2;
  } else {
    spans[0].lg = 2;
    spans[0].tall = true;
    const after = (rest - 2) % 3;
    if (after === 1) spans[count - 1].lg = 3;
    if (after === 2) spans[count - 1].lg = 2;
  }
  return spans;
}
