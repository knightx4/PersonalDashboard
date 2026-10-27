import type { PushPayload } from '@/lib/push/send';
import { BODY_MAX, clip, TITLE_MAX } from '@/lib/day-brief/notification';
import { openReviews, reviewDates, reviewsOf } from '@/lib/you/board-reviews';
import { tripwireDue, tripwireOf } from '@/lib/you/board-tripwires';

/**
 * What the daily board notification announces (plan #2581.10, run by
 * inngest/you/board-due.ts once a day through /api/cron/board-due). A
 * decision's check-back falls due 30 and 90 days after it was decided, and a
 * tripwire on its check_on date. Each is announced once: the keys sent are
 * kept in you.board_questions.notified (migrations-you/0030).
 */

export type DueNotice = {
  questionId: string;
  question: string;
  kind: 'review' | 'tripwire';
  /** The key recorded in `notified`: review:30, review:90 or tripwire:<check_on>. */
  key: string;
};

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

function notifiedOf(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** The check-backs and tripwire on one question that are due by `today` and not yet announced. */
export function dueNotices(row: Record<string, unknown>, today: string): DueNotice[] {
  if (typeof row.id !== 'string') return [];
  const questionId = row.id;
  const question = text(row.question);
  const notified = notifiedOf(row.notified);
  const out: DueNotice[] = [];
  if (row.status === 'decided' && typeof row.decided_at === 'string') {
    const written = reviewsOf(row.reviews);
    const all = reviewDates(row.decided_at)
      .filter((d) => d.due <= today)
      .map((d) => ({ at: d.at, outcome: written.find((r) => r.at === d.at)?.outcome ?? null }));
    for (const review of openReviews(all)) {
      const key = `review:${review.at}`;
      if (!(key in notified)) out.push({ questionId, question, kind: 'review', key });
    }
  }
  const wire = tripwireOf(row.tripwire);
  if (wire && tripwireDue(wire, today)) {
    const key = `tripwire:${wire.checkOn}`;
    if (!(key in notified)) out.push({ questionId, question, kind: 'tripwire', key });
  }
  return out;
}

/** One notification for everything due today, opening the Board tab. */
export function duePayload(notices: readonly DueNotice[], day: string): PushPayload {
  const reviews = notices.filter((n) => n.kind === 'review');
  const wires = notices.filter((n) => n.kind === 'tripwire');
  const questions = [...new Set(notices.map((n) => n.question))];
  const title =
    notices.length === 1
      ? reviews.length === 1
        ? 'How did your decision go?'
        : 'A tripwire is due'
      : wires.length === 0
        ? `${reviews.length} decisions to check back on`
        : reviews.length === 0
          ? `${wires.length} tripwires are due`
          : `${notices.length} decisions to check on`;
  const body =
    questions.length === 1
      ? wires.length > 0 && reviews.length === 0
        ? `Did what would reopen "${questions[0]}" happen?`
        : `${questions[0]} Say how it turned out, and the advisors are scored on it.`
      : questions.join(' · ');
  return {
    title: clip(title, TITLE_MAX),
    body: clip(body, BODY_MAX),
    url: '/you/board',
    tag: `board-due-${day}`,
  };
}
