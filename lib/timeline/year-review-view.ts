import { eventRef, type TimelineEvent } from './timeline';
import type { YearParagraph, YearReviewRecord, YearTopic, YearTotals } from './year-review';
import { MIN_EVENTS_TO_WRITE } from './year-review';

/**
 * The year's page as it is drawn (plan #1121): the stored review when there
 * is one, with each paragraph's rows found again among the year's events,
 * and the counts from the timeline when there is not. Pure, so the page and
 * the tests share one set of rules.
 */

export type ShownParagraph = {
  topic: YearTopic;
  text: string;
  /** The rows it cites that are still on the timeline, newest first. */
  events: TimelineEvent[];
};

export type YearState =
  /** A review is stored. */
  | { kind: 'written'; writtenAt: string; through: string; complete: boolean; eventsThen: number; eventsSince: number }
  /** Enough events to write about and nothing stored yet. */
  | { kind: 'unwritten' }
  /** Some events, too few to write about. */
  | { kind: 'too-few'; events: number }
  /** Nothing on the timeline in the year. */
  | { kind: 'empty' };

export type YearReviewShown = {
  state: YearState;
  /** The stored totals when a review is stored, so the paragraphs and the numbers agree; the live ones otherwise. */
  totals: YearTotals;
  paragraphs: ShownParagraph[];
};

export function showYearReview(
  stored: YearReviewRecord | null,
  live: YearTotals,
  events: readonly TimelineEvent[],
): YearReviewShown {
  if (!stored) {
    const state: YearState =
      live.events === 0
        ? { kind: 'empty' }
        : live.events < MIN_EVENTS_TO_WRITE
          ? { kind: 'too-few', events: live.events }
          : { kind: 'unwritten' };
    return { state, totals: live, paragraphs: [] };
  }

  const byRef = new Map(events.map((event) => [eventRef(event), event]));
  const since = stored.complete ? 0 : events.filter((event) => event.occurred_at >= stored.through).length;
  return {
    state: {
      kind: 'written',
      writtenAt: stored.written_at,
      through: stored.through,
      complete: stored.complete,
      eventsThen: stored.events,
      eventsSince: since,
    },
    totals: stored.totals,
    paragraphs: (stored.paragraphs ?? []).map((paragraph: YearParagraph) => ({
      topic: paragraph.topic,
      text: paragraph.text,
      events: [...new Set(paragraph.evidence)]
        .map((ref) => byRef.get(ref))
        .filter((event): event is TimelineEvent => event !== undefined)
        .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)),
    })),
  };
}
