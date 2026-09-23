/**
 * Which cards in the Learn now feed count as passed (plan #835,
 * LEARN-NOW-SPEC "What is recorded").
 *
 * A card is passed when you press Next on it, or when it has been on the
 * screen and then leaves through the top because you scrolled on. A card that
 * never came into view, or that leaves off the bottom because you scrolled
 * back up, is not. Each card is passed at most once per visit, so Next and
 * the scroll it causes make one write between them, and a card you saved or
 * turned down is never passed afterwards.
 *
 * Kept apart from the page so it is tested without a browser: the feed feeds
 * it what its IntersectionObserver reports and supplies `pass`, which calls
 * the server action.
 */

/** What an IntersectionObserver entry says about one card, reduced to what matters here. */
export type Sighting = {
  isIntersecting: boolean;
  /** The card's bottom edge. */
  bottom: number;
  /** The top edge of the area watched; 0 for the viewport. */
  rootTop: number;
};

export type PassTracker = {
  /** Feed one observer report for a card. True when it marked the card passed. */
  sighted(id: string, sighting: Sighting): boolean;
  /** Next was pressed on the card. True when this made the write. */
  next(id: string): boolean;
  /** The card was saved or turned down this visit, so it is never passed. */
  settle(id: string): void;
};

export function leftThroughTop(sighting: Sighting): boolean {
  return !sighting.isIntersecting && sighting.bottom <= sighting.rootTop;
}

export function createPassTracker(pass: (id: string) => void): PassTracker {
  const seen = new Set<string>();
  const done = new Set<string>();

  const mark = (id: string) => {
    if (done.has(id)) return false;
    done.add(id);
    pass(id);
    return true;
  };

  return {
    sighted(id, sighting) {
      if (sighting.isIntersecting) {
        seen.add(id);
        return false;
      }
      return seen.has(id) && leftThroughTop(sighting) ? mark(id) : false;
    },
    next: mark,
    settle(id) {
      done.add(id);
    },
  };
}
