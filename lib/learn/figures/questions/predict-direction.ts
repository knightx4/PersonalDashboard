import { z } from 'zod';
import type { ChartData, ChartLine } from '../kinds/chart-data';
import type { FigureQuestionForm } from '../types';

/**
 * Predict the direction (plan #2321.5): a chart of a real series drawn only
 * up to a year, and a pick of which way its first line went after it. The
 * writer names the series and the year; the answer comes from the fetched
 * numbers, never from the writer, as the chart's own numbers do.
 *
 * A move too small to call either way is not asked: a fall of three per cent
 * is "about level" to one reader and "fell" to another, so the form only
 * poses a question when the move is plainly level or plainly not.
 */

export type Direction = 'rose' | 'fell' | 'level';

const askSchema = z.object({
  /** The last year drawn. The question asks about the years after it. */
  cutAt: z.number().int().min(1700).max(2100),
  /** What the first line measures, as a sentence's subject: "India's life expectancy". */
  subject: z.string().trim().min(3).max(80),
});

export type PredictDirectionAsk = z.infer<typeof askSchema>;

/** At most this share of the start is "about level". */
const LEVEL_SHARE = 0.015;
/** At least this share is "rose" or "fell". Between the two the question is not asked. */
const MOVED_SHARE = 0.05;
/** The chart keeps at least this many years before the cut, so there is a trend to read. */
const MIN_YEARS_SHOWN = 3;

/** Which way a line went from the cut to its last year, or null when the move is too small to call. */
export function directionAfter(line: ChartLine, cutAt: number): Direction | null {
  const before = line.points.filter((point) => point.year <= cutAt);
  const after = line.points.filter((point) => point.year > cutAt);
  if (before.length < MIN_YEARS_SHOWN || after.length === 0) return null;
  const start = before[before.length - 1].value;
  const end = after[after.length - 1].value;
  const share = Math.abs(end - start) / Math.max(Math.abs(start), 1e-9);
  if (share <= LEVEL_SHARE) return 'level';
  if (share < MOVED_SHARE) return null;
  return end > start ? 'rose' : 'fell';
}

const CHOICES: Array<{ value: Direction; label: string }> = [
  { value: 'rose', label: 'It rose' },
  { value: 'fell', label: 'It fell' },
  { value: 'level', label: 'It stayed about level' },
];

/** The chart's data drawn up to the cut: every line stops there, and so do the years in its foot. */
function cut(data: ChartData, cutAt: number): ChartData {
  const lines = data.lines.map((line) => ({ ...line, points: line.points.filter((point) => point.year <= cutAt) }));
  return { lines, from: data.from, to: Math.min(cutAt, data.to) };
}

export function predictDirectionForm<Spec extends { to?: number | null }>(): FigureQuestionForm<Spec, ChartData, PredictDirectionAsk> {
  return {
    id: 'predict_direction',
    label: 'Which way next',
    writerLine:
      'predict_direction: the chart drawn only up to a year, and a pick of whether its first series rose, fell or stayed about level after it, for a level whose checks are about what drives a quantity or what follows from a change: a rate after a policy, a price after a shock. ask is {"cutAt": the last year drawn, at least three years after the chart\'s first, "subject": what the first series measures as a sentence\'s subject, such as "India\'s life expectancy"}. Choose a year after which the series moved in a way the level\'s idea explains. You never write the answer: it is read from the fetched numbers, and a move too small to call is not asked.',
    schema: askSchema,
    pose({ spec, resolved, ask }) {
      const line = resolved?.lines[0];
      if (!line) return null;
      const answer = directionAfter(line, ask.cutAt);
      if (!answer) return null;
      const to = line.points[line.points.length - 1].year;
      return {
        spec: { ...spec, to: ask.cutAt },
        resolved: cut(resolved, ask.cutAt),
        prompt: `The chart stops at ${ask.cutAt}. From ${ask.cutAt} to ${to}, what did ${ask.subject} do?`,
        choices: CHOICES.map((choice) => ({ ...choice })),
        answer,
      };
    },
    grade: (answer, response) => (response === answer ? 'met' : 'not_met'),
    example: { cutAt: 2010, subject: 'India’s life expectancy' },
  };
}
