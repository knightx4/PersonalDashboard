import type { SpendReport } from '@/lib/core/spend/pricing';
import { monthStart, type MonthFacts } from './facts';
import { checkWording, plainWording, type RawWording, type StoredLine } from './write';

/**
 * One person's monthly money review (plan #2593.8.2): work out the month's
 * facts, have Dash word them, and store one row for the month.
 *
 * A month is written once. The daily cron calls this every day and it stops
 * at the stored row, so the review appears on the first of the month and a
 * day the cron missed is made up the next. Two cases run again:
 *
 *   - A failed review, up to MAX_ATTEMPTS in all, so a model outage on the
 *     first does not leave the month without one. Try again on the page
 *     passes `force` and runs whatever the count.
 *   - A review written for a month with nothing in it, once facts turn up
 *     (accounts linked mid-month bring their history with them).
 *
 * A person with no accounts at all gets no row: there is nothing to review
 * and nothing for the page to show. A month with nothing in it gets a plain
 * row without a model call. Without a key the code's own sentences are
 * stored. A failure in the model call stores the row as failed, with the
 * code's sentences in its lines, and so does a failure reading the facts,
 * with no lines.
 */

export const MAX_ATTEMPTS = 3;

export type MonthReviewRow = {
  user_id: string;
  /** YYYY-MM-01. */
  month: string;
  status: 'written' | 'failed';
  source: 'model' | 'plain' | null;
  model: string | null;
  summary: string | null;
  lines: StoredLine[];
  facts: Record<string, unknown>;
  error: string | null;
  attempts: number;
  written_at: string | null;
};

export type ExistingReview = {
  status: 'written' | 'failed';
  source: 'model' | 'plain' | null;
  attempts: number;
  lineCount: number;
};

export type MonthReviewPorts = {
  existing(userId: string, month: string): Promise<ExistingReview | null>;
  /** The month's facts, or null when the person holds no accounts. */
  facts(userId: string, month: string, today: string): Promise<MonthFacts | null>;
  /** The model's wording, unchecked; null when there is no model to ask. */
  word(facts: MonthFacts, onSpend: (report: SpendReport) => void): Promise<{ model: string; wording: RawWording | null } | null>;
  /** What a model call cost, against this person. */
  ledger(userId: string, report: SpendReport): Promise<void>;
  /** Writes the month's row, replacing one already there. */
  save(row: MonthReviewRow): Promise<void>;
};

export type MonthReviewResult =
  | { status: 'already-written' }
  | { status: 'gave-up'; attempts: number }
  | { status: 'no-accounts' }
  | { status: 'unchanged' }
  | { status: 'written'; source: 'model' | 'plain'; lines: number; dropped: number }
  | { status: 'failed'; error: string };

function message(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  return text.slice(0, 500);
}

/** The figures behind each line, as finances.month_reviews.facts keeps them. */
function factsColumn(facts: MonthFacts): Record<string, unknown> {
  return {
    label: facts.label,
    facts: facts.facts.map((f) => ({ id: f.id, kind: f.kind, figures: f.figures })),
  };
}

export async function runMonthReviewFor(
  ports: MonthReviewPorts,
  userId: string,
  options: { month: string; today: string; now: Date; force?: boolean },
): Promise<MonthReviewResult> {
  const month = monthStart(options.month);
  const existing = await ports.existing(userId, month);
  const emptyBefore = existing?.status === 'written' && existing.lineCount === 0;
  if (existing && !options.force) {
    if (existing.status === 'written' && !emptyBefore) return { status: 'already-written' };
    if (existing.status === 'failed' && existing.attempts >= MAX_ATTEMPTS) {
      return { status: 'gave-up', attempts: existing.attempts };
    }
  }
  const attempts = (existing?.attempts ?? 0) + 1;
  const base = { user_id: userId, month, attempts };

  let facts: MonthFacts | null;
  try {
    facts = await ports.facts(userId, options.month, options.today);
  } catch (err) {
    const error = message(err);
    // A month already written stays as it was; only a missing or failed one records the failure.
    if (existing?.status === 'written') return { status: 'failed', error };
    await ports.save({
      ...base,
      status: 'failed',
      source: null,
      model: null,
      summary: null,
      lines: [],
      facts: {},
      error,
      written_at: null,
    });
    return { status: 'failed', error };
  }
  if (!facts) return { status: 'no-accounts' };
  if (emptyBefore && facts.facts.length === 0 && !options.force) return { status: 'unchanged' };

  const writtenAt = options.now.toISOString();
  const plain = plainWording(facts);
  if (facts.facts.length === 0) {
    await ports.save({
      ...base,
      status: 'written',
      source: 'plain',
      model: null,
      summary: plain.summary,
      lines: [],
      facts: factsColumn(facts),
      error: null,
      written_at: writtenAt,
    });
    return { status: 'written', source: 'plain', lines: 0, dropped: 0 };
  }

  const reports: SpendReport[] = [];
  try {
    const reply = await ports.word(facts, (report) => reports.push(report));
    const checked = reply ? checkWording(reply.wording, facts) : plain;
    await ports.save({
      ...base,
      status: 'written',
      source: checked.source,
      model: checked.source === 'model' && reply ? reply.model : null,
      summary: checked.summary,
      lines: checked.lines,
      facts: factsColumn(facts),
      error: null,
      written_at: writtenAt,
    });
    return { status: 'written', source: checked.source, lines: checked.lines.length, dropped: checked.dropped.length };
  } catch (err) {
    const error = message(err);
    if (existing?.status === 'written' && !emptyBefore) return { status: 'failed', error };
    await ports.save({
      ...base,
      status: 'failed',
      source: null,
      model: null,
      summary: plain.summary,
      lines: plain.lines,
      facts: factsColumn(facts),
      error,
      written_at: null,
    });
    return { status: 'failed', error };
  } finally {
    for (const report of reports) await ports.ledger(userId, report);
  }
}
