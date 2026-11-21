import 'server-only';

import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { fireFeatureRoutine, goalsRoutine } from '@/lib/feedback/routine';
import { BUILD_STALE_MS } from '@/lib/learn/courses/build';
import { queueCourse, type NewCourse } from '@/lib/learn/courses/store';

/**
 * Asking for a course. Nothing here calls a model: the press writes a row and
 * fires the goals routine with the learn-courses skill, whose session builds
 * the digest on the person's Claude subscription (learn 0194).
 */

export type CourseRequest = { id: string; created: boolean; fired: boolean; detail: string };

export function courseRoutineBrief(waiting: number): string {
  return [
    'Follow .claude/skills/learn-courses/SKILL.md.',
    `Course digests: ${waiting} waiting in learn.courses for the owner.`,
    'Build each one in the order `npm run learn:course -- next` gives them, and stop when it returns null.',
  ].join('\n');
}

/** Queue a course and start the routine on it. Never throws for a routine that will not start: the course waits. */
export async function requestCourse(
  client: LearnSupabaseClient,
  userId: string,
  course: NewCourse,
): Promise<CourseRequest> {
  const queued = await queueCourse(client, userId, course);
  if (!queued.created) return { ...queued, fired: false, detail: 'You already have this course.' };
  const fired = await fireCourseRoutine(client, userId);
  return { ...queued, fired: fired.ok, detail: fired.detail };
}

/** Start the routine on the waiting courses, unless a session is already building. */
export async function fireCourseRoutine(
  client: LearnSupabaseClient,
  userId: string,
): Promise<{ ok: boolean; detail: string }> {
  try {
    const since = new Date(Date.now() - BUILD_STALE_MS).toISOString();
    const [{ count: waiting }, { count: working }] = await Promise.all([
      client
        .from('courses')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('status', 'queued'),
      client
        .from('courses')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('status', 'building')
        .gte('updated_at', since),
    ]);
    if (!waiting) return { ok: true, detail: 'Nothing is waiting to be built.' };
    if (working)
      return { ok: true, detail: 'Dash is already building a course; this one is next.' };
    const routine = goalsRoutine();
    if (!routine.id)
      return {
        ok: false,
        detail: 'Queued, but no routine is set to build it (CLAUDE_GOALS_ROUTINE_ID), so it waits.',
      };
    const fired = await fireFeatureRoutine({
      apiKey: routine.token,
      routineId: routine.id,
      text: courseRoutineBrief(waiting),
    });
    if (!fired.ok)
      return { ok: false, detail: `Queued, but the build did not start: ${fired.error}` };
    return { ok: true, detail: 'Dash is building it. A long series takes an hour or more.' };
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : 'The build did not start.',
    };
  }
}
