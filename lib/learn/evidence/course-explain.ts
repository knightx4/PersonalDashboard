/**
 * One explain prompt per graded course, and the tested marks its answer
 * leaves in place of the course's band (plan #2172.4.2). Pure, so the rules
 * can be tested without a database or a model; the store is
 * ./course-explain-store and the grading call is the levels grader
 * (lib/learn/levels/grade-call.ts) with its course scope.
 *
 * The prompt is written here, with no model call: the course's name and the
 * topics it was named for (learn.course_topics), and what a full answer does
 * for each. The answer is graded against levels 1 to 3 of every one of those
 * topics, the levels an explanation can show (4 to 6 are cases). The checks
 * are the shared ladder's, with the topic's name in them.
 *
 * What each topic is left with:
 * - a met on any level: tested at the highest level met, with the words that
 *   met it. The band gives way to it.
 * - a not met and no met: marked 0, and the course's link to the topic is
 *   cleared. The band was a guess the answer did not bear out.
 * - neither: no mark. Silence about a topic is not a failure of it, so the
 *   band stays.
 *
 * A met needs its quote verbatim in the answer, as every graded answer does
 * (applyGradeRules in lib/learn/levels/grade.ts).
 */

import { applyGradeRules, type GraderCell, type RawVerdict } from '@/lib/learn/levels/grade';
import { courseBasis, type CourseSource } from './courses';

/** The levels an explanation about a course is graded on. */
export const EXPLAIN_LEVELS = [1, 2, 3] as const;
/** The most topics a prompt names; a course is named for eight at most anyway. */
export const PROMPT_TOPICS = 8;

export type ExplainTopic = { id: string; title: string };

/** One topic's result, as learn.course_explains.marks keeps it. Level 0 is a miss. */
export type CourseMark = { topic_id: string; level: number; quote: string | null; basis: string };

/** "a", "a and b", "a, b and c" */
function joined(parts: readonly string[]): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/**
 * The question on the course row: explain the course to a friend who never
 * took it, through the topics it was named for. The row names the course.
 */
export function courseExplainPrompt(topics: readonly ExplainTopic[]): string {
  // The row above the prompt names the course, so the question says "this course".
  const base = 'Explain what this course taught you to a friend who never took it.';
  const titles = topics.slice(0, PROMPT_TOPICS).map((t) => t.title.trim()).filter(Boolean);
  if (titles.length === 0) return `${base} Say what each idea means, how it works and why it is there.`;
  return `${base} Take the ideas you remember from ${joined(titles)}, and for each say what it means, how it works and why each part is there.`;
}

/** The checks for one level of a topic, from the ladder's "you can" column. */
export function levelChecks(title: string, level: number): string[] {
  const name = title.trim();
  switch (level) {
    case 1:
      return [`Says what field ${name} belongs to.`, `Says what ${name} is used for.`];
    case 2:
      return [`Defines ${name} accurately in their own words.`, 'Does not lean on the term itself to define it.'];
    case 3:
      return [`Explains how ${name} works, part by part.`, 'Says why each part is there.'];
    default:
      return [];
  }
}

/** The cells the answer is graded against: levels 1 to 3 of every topic, in topic order. */
export function courseExplainCells(topics: readonly ExplainTopic[]): GraderCell[] {
  const out: GraderCell[] = [];
  for (const topic of topics.slice(0, PROMPT_TOPICS)) {
    for (const level of EXPLAIN_LEVELS) {
      out.push({
        key: `C${out.length + 1}`,
        cellId: `${topic.id}:${level}`,
        topicId: topic.id,
        topicName: topic.title,
        level,
        descriptor: levelChecks(topic.title, level),
        role: 'course',
      });
    }
  }
  return out;
}

/** "tested at level 2" */
export function testedWords(level: number): string {
  return `tested at level ${level}`;
}

/**
 * The reason beside a tested mark, as the link's basis:
 * "from FIN 610 Private Equity, H, 2025, and your explanation of it: tested at level 2."
 */
export function testedBasis(course: Pick<CourseSource, 'code' | 'title' | 'grade' | 'year'>, level: number): string {
  return `${courseBasis(course)}, and your explanation of it: ${testedWords(level)}.`;
}

/**
 * The marks an answer makes, one per topic it went to, in topic order. The
 * grade rules run first, with every cell read as asked so a miss on any
 * topic's level counts.
 */
export function courseMarks(input: {
  course: Pick<CourseSource, 'code' | 'title' | 'grade' | 'year'>;
  cells: readonly GraderCell[];
  answer: string;
  verdicts: readonly RawVerdict[];
}): CourseMark[] {
  const asked = input.cells.map((c) => ({ ...c, role: 'asked' as const }));
  const { write } = applyGradeRules({ cells: asked, answer: input.answer, verdicts: input.verdicts });
  const cellById = new Map(input.cells.map((c) => [c.cellId, c]));
  const best = new Map<string, { level: number; quote: string | null }>();
  for (const w of write) {
    const cell = cellById.get(w.cellId);
    if (!cell) continue;
    const seen = best.get(cell.topicId);
    if (w.verdict === 'met') {
      if (!seen || seen.level < cell.level) best.set(cell.topicId, { level: cell.level, quote: w.quote });
    } else if (!seen) {
      best.set(cell.topicId, { level: 0, quote: null });
    }
  }
  const order = [...new Set(input.cells.map((c) => c.topicId))];
  return order
    .filter((id) => best.has(id))
    .map((id) => {
      const { level, quote } = best.get(id)!;
      return {
        topic_id: id,
        level,
        quote,
        basis: level > 0 ? testedBasis(input.course, level) : `${courseBasis(input.course)}: your explanation did not show it.`,
      };
    });
}

/** The marks as the course row reads them: tested topics first, by level, then misses. */
export type TopicResult = { title: string; level: number };

/** What a course row shows: a prompt to answer, or what the answer showed. */
export type CourseExplain =
  | { state: 'offer'; question: string; topics: ExplainTopic[] }
  | { state: 'tested'; results: TopicResult[]; answeredAt: string };

export function markResults(marks: readonly CourseMark[], topics: readonly ExplainTopic[]): TopicResult[] {
  const titles = new Map(topics.map((t) => [t.id, t.title]));
  return marks
    .filter((m) => titles.has(m.topic_id))
    .map((m) => ({ title: titles.get(m.topic_id)!, level: m.level }))
    .sort((a, b) => b.level - a.level || a.title.localeCompare(b.title));
}

/** One line for the course row: "Tested: Investment at level 3, Debt at level 1. Not shown: Equity." */
export function marksLine(results: readonly TopicResult[]): string {
  const tested = results.filter((r) => r.level > 0).map((r) => `${r.title} at level ${r.level}`);
  const missed = results.filter((r) => r.level === 0).map((r) => r.title);
  const parts: string[] = [];
  if (tested.length > 0) parts.push(`Tested: ${joined(tested)}.`);
  if (missed.length > 0) parts.push(`Not shown: ${joined(missed)}.`);
  return parts.length > 0 ? parts.join(' ') : 'Your explanation did not reach any of its topics, so the course keeps its likely levels.';
}
