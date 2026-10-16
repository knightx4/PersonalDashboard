import 'server-only';

import type { SpendSink } from '@/lib/core/spend/pricing';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { gradeCellAnswer, LEVEL_GRADE_MODEL } from '@/lib/learn/levels/grade-call';
import { isGraded } from './course-bands';
import {
  courseExplainCells,
  courseExplainPrompt,
  courseMarks,
  markResults,
  type CourseExplain,
  type CourseMark,
  type ExplainTopic,
  type TopicResult,
} from './course-explain';
import { courseName, type CourseSource } from './courses';

/**
 * The explain prompt on each graded course row (plan #2172.4.2): what the
 * row offers, and grading the answer. Runs on the session client, so RLS
 * keeps every read to the person's own: learn.course_topics and
 * learn.course_explains are theirs to read, the explanation theirs to
 * insert, and learn.apply_course_explain (learn 0158) moves the marks onto
 * their course links, which they cannot write directly.
 *
 * The rules are in ./course-explain; the daily band stage reads the same
 * marks (./course-band-store), so a renamed course keeps them.
 */

type CourseFacts = Pick<CourseSource, 'code' | 'title' | 'grade' | 'year'>;

type NamingRow = { course_id: string; topics: { id: string }[] };
type ExplainRow = { course_id: string; topics: ExplainTopic[]; marks: CourseMark[]; answered_at: string };

async function topicTitles(learn: LearnSupabaseClient, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await learn.from('area_check_articles').select('id, title').in('id', ids);
  if (error) throw new Error(`Reading the course topics failed: ${error.message}`);
  return new Map(((data ?? []) as { id: string; title: string }[]).map((r) => [r.id, r.title]));
}

/** The topics a naming holds, with their titles, in the order the call named them. */
function namedTopics(naming: NamingRow, titles: ReadonlyMap<string, string>): ExplainTopic[] {
  return naming.topics
    .map((t) => ({ id: t.id, title: titles.get(t.id) ?? '' }))
    .filter((t) => t.title !== '');
}

/**
 * The explain prompt or tested marks for each graded course that was named
 * for its topics. A course with no naming, or whose grade does not count,
 * is left out: it has no band to replace.
 */
export async function loadCourseExplains(
  learn: LearnSupabaseClient,
  courses: readonly (CourseFacts & { id: string })[],
): Promise<Record<string, CourseExplain>> {
  const graded = courses.filter(isGraded);
  if (graded.length === 0) return {};
  const ids = graded.map((c) => c.id);
  const [namings, explains] = await Promise.all([
    learn
      .from('course_topics')
      .select('course_id, topics')
      .in('course_id', ids)
      .then(({ data, error }) => {
        if (error) throw new Error(`Reading the course topics failed: ${error.message}`);
        return (data ?? []) as NamingRow[];
      }),
    learn
      .from('course_explains')
      .select('course_id, topics, marks, answered_at')
      .in('course_id', ids)
      .then(({ data, error }) => {
        if (error) throw new Error(`Reading the course explanations failed: ${error.message}`);
        return (data ?? []) as ExplainRow[];
      }),
  ]);
  const titles = await topicTitles(learn, [...new Set(namings.flatMap((n) => n.topics.map((t) => t.id)))]);
  const byId = new Map(graded.map((c) => [c.id, c]));
  const out: Record<string, CourseExplain> = {};
  for (const naming of namings) {
    const course = byId.get(naming.course_id);
    const topics = namedTopics(naming, titles);
    if (!course || topics.length === 0) continue;
    out[naming.course_id] = { state: 'offer', question: courseExplainPrompt(topics), topics };
  }
  for (const explain of explains) {
    out[explain.course_id] = {
      state: 'tested',
      results: markResults(explain.marks, explain.topics),
      answeredAt: explain.answered_at,
    };
  }
  return out;
}

export type AnswerCourseResult = { ok: true; results: TopicResult[] } | { ok: false; error: string };

/**
 * Grade the answer to a course's explain prompt, keep it with its marks, and
 * put the marks on the course's links. Nothing is written when grading
 * fails, so the same answer can be sent again. A course already answered is
 * refused before anything is spent.
 */
export async function answerCourseExplain(
  learn: LearnSupabaseClient,
  userId: string,
  input: { course: CourseFacts & { id: string }; response: string; anthropicApiKey: string; onSpend?: SpendSink },
): Promise<AnswerCourseResult> {
  const response = input.response.trim();
  if (response === '') return { ok: false, error: 'Write an answer first.' };
  if (!isGraded(input.course)) return { ok: false, error: 'Only a graded course is asked about.' };

  const { data: done } = await learn.from('course_explains').select('course_id').eq('course_id', input.course.id).maybeSingle();
  if (done) return { ok: false, error: 'This course has been explained already.' };

  const { data: naming, error: namingError } = await learn
    .from('course_topics')
    .select('course_id, topics')
    .eq('course_id', input.course.id)
    .maybeSingle();
  if (namingError) return { ok: false, error: `Reading the course topics failed: ${namingError.message}` };
  if (!naming) return { ok: false, error: 'Dash has not named this course’s topics yet.' };
  const row = naming as NamingRow;
  const titles = await topicTitles(learn, row.topics.map((t) => t.id));
  const topics = namedTopics(row, titles);
  if (topics.length === 0) return { ok: false, error: 'This course has no topics to explain.' };

  const question = courseExplainPrompt(topics);
  const cells = courseExplainCells(topics);
  const grade = await gradeCellAnswer({
    cells,
    // The grader is told which course, which the row says on screen.
    question: `About ${courseName(input.course)}: ${question}`,
    answer: response,
    anthropicApiKey: input.anthropicApiKey,
    onSpend: input.onSpend,
    scope: 'course',
  });
  if (!grade.ok) {
    console.error('[learn course explain] grading', grade.detail);
    return { ok: false, error: 'Dash could not grade this answer just now.' };
  }
  const marks = courseMarks({ course: input.course, cells, answer: response, verdicts: grade.verdicts });
  const keyToCell = new Map(cells.map((c) => [c.key, c.cellId]));

  const { error: insertError } = await learn.from('course_explains').insert({
    course_id: input.course.id,
    user_id: userId,
    question,
    topics,
    response,
    grade: grade.verdicts
      .filter((v) => keyToCell.has(v.cell))
      .map((v) => ({ cell: keyToCell.get(v.cell), verdict: v.verdict, quote: v.quote ?? null, reason: v.reason ?? null })),
    marks,
    model: LEVEL_GRADE_MODEL,
  });
  if (insertError) {
    // The primary key is the course: a second press lands here.
    if (insertError.code === '23505') return { ok: false, error: 'This course has been explained already.' };
    return { ok: false, error: `Saving your answer failed: ${insertError.message}` };
  }

  const rpc = learn.rpc.bind(learn) as unknown as (
    name: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ error: { message: string } | null }>;
  const { error: applyError } = await rpc('apply_course_explain', { p_course_id: input.course.id });
  // The answer and its marks are kept; the daily band stage writes the same
  // links from them, so a failure here is caught up overnight.
  if (applyError) console.error('[learn course explain] apply', applyError.message);

  return { ok: true, results: markResults(marks, topics) };
}
