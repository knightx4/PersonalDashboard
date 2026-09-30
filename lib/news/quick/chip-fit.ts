/**
 * How many topic chips fit on one line beside "All topics" and a "More" chip
 * (note 56043a15), from their measured widths.
 *
 * Returns null when every chip fits without "More", so the row is drawn whole.
 * Otherwise returns how many topic chips to draw before "More", which may be
 * zero on a very narrow screen: "All topics" and "More" are always drawn.
 */
export function chipsThatFit({
  all,
  topics,
  more,
  available,
  gap,
}: {
  /** The width of the "All topics" chip. */
  all: number;
  /** Each topic chip's width, in the order they are drawn. */
  topics: readonly number[];
  /** The width of the "More" chip. */
  more: number;
  /** The width of the row. */
  available: number;
  /** The space between two chips. */
  gap: number;
}): number | null {
  const whole = topics.reduce((sum, width) => sum + gap + width, all);
  if (whole <= available) return null;

  let used = all + gap + more;
  let fit = 0;
  for (const width of topics) {
    if (used + gap + width > available) break;
    used += gap + width;
    fit += 1;
  }
  return fit;
}
