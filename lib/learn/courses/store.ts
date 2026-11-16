import 'server-only';

import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import {
  checkDigest,
  checkLectures,
  digestTotals,
  type Digest,
  type Lecture,
} from '@/lib/learn/courses/digest';
import {
  BUILD_STEPS,
  freshSteps,
  type BuildStep,
  type CourseProgress,
  type CourseStatus,
  type StepKey,
  type StepState,
} from '@/lib/learn/courses/build';

/**
 * Reading and writing course digests (learn 0194). The pages read with the
 * person's own client; the routine's script (scripts/learn-course.ts) writes
 * with the service role, always for one user id.
 */

export type CourseTotals = Partial<ReturnType<typeof digestTotals>> & { videos?: number };

export type CourseSummary = {
  id: string;
  title: string;
  provider: string | null;
  sourceUrl: string | null;
  about: string | null;
  goal: string | null;
  budgetMinutes: number;
  catalogueKey: string | null;
  status: CourseStatus;
  steps: BuildStep[];
  totals: CourseTotals;
  progress: CourseProgress;
  error: string | null;
  runUrl: string | null;
  requestedAt: string;
  takenAt: string | null;
  builtAt: string | null;
};

export type Course = CourseSummary & { digest: Digest | null; lectures: Lecture[] };

const SUMMARY_COLUMNS =
  'id, title, provider, source_url, about, goal, budget_minutes, catalogue_key, status, steps, totals, progress, error, run_url, requested_at, taken_at, built_at';

type Row = Record<string, unknown>;

function readSummary(row: Row): CourseSummary {
  const progress = (row.progress ?? {}) as Partial<CourseProgress>;
  return {
    id: row.id as string,
    title: row.title as string,
    provider: (row.provider as string | null) ?? null,
    sourceUrl: (row.source_url as string | null) ?? null,
    about: (row.about as string | null) ?? null,
    goal: (row.goal as string | null) ?? null,
    budgetMinutes: (row.budget_minutes as number) ?? 180,
    catalogueKey: (row.catalogue_key as string | null) ?? null,
    status: row.status as CourseStatus,
    steps: Array.isArray(row.steps) ? (row.steps as BuildStep[]) : [],
    totals: (row.totals ?? {}) as CourseTotals,
    progress: { clips: progress.clips ?? [], lessons: progress.lessons ?? [] },
    error: (row.error as string | null) ?? null,
    runUrl: (row.run_url as string | null) ?? null,
    requestedAt: row.requested_at as string,
    takenAt: (row.taken_at as string | null) ?? null,
    builtAt: (row.built_at as string | null) ?? null,
  };
}

function readLecture(row: Row): Lecture {
  return {
    code: row.code as string,
    title: row.title as string,
    videoId: row.video_id as string,
    durationSeconds: row.duration_seconds as number,
    speaker: (row.speaker as string | null) ?? null,
  };
}

/** The person's courses, the ones being built first, then newest. */
export async function loadCourses(
  client: LearnSupabaseClient,
  userId: string,
): Promise<CourseSummary[]> {
  const { data, error } = await client
    .from('courses')
    .select(SUMMARY_COLUMNS)
    .eq('user_id', userId)
    .order('requested_at', { ascending: false });
  if (error) throw new Error(`Reading courses failed: ${error.message}`);
  const rows = ((data ?? []) as Row[]).map(readSummary);
  const open = (course: CourseSummary) =>
    course.status === 'queued' || course.status === 'building' ? 0 : 1;
  return rows.sort((a, b) => open(a) - open(b));
}

export async function loadLectures(
  client: LearnSupabaseClient,
  userId: string,
  courseId: string,
): Promise<Lecture[]> {
  const { data, error } = await client
    .from('course_lectures')
    .select('code, title, video_id, duration_seconds, speaker')
    .eq('user_id', userId)
    .eq('course_id', courseId)
    .order('position');
  if (error) throw new Error(`Reading the course's lectures failed: ${error.message}`);
  return ((data ?? []) as Row[]).map(readLecture);
}

/** One course with its digest and lectures, or null when it is not this person's. */
export async function loadCourse(
  client: LearnSupabaseClient,
  userId: string,
  courseId: string,
): Promise<Course | null> {
  const { data, error } = await client
    .from('courses')
    .select(`${SUMMARY_COLUMNS}, digest`)
    .eq('user_id', userId)
    .eq('id', courseId)
    .maybeSingle();
  if (error) throw new Error(`Reading the course failed: ${error.message}`);
  if (!data) return null;
  const row = data as unknown as Row;
  const lectures = await loadLectures(client, userId, courseId);
  return { ...readSummary(row), digest: (row.digest as Digest | null) ?? null, lectures };
}

export type NewCourse = {
  title: string;
  provider?: string | null;
  sourceUrl?: string | null;
  about?: string | null;
  goal?: string | null;
  budgetMinutes?: number;
  catalogueKey?: string | null;
};

/** Queue a course for the routine. A catalogue course already asked for is found, not queued twice. */
export async function queueCourse(
  client: LearnSupabaseClient,
  userId: string,
  course: NewCourse,
): Promise<{ id: string; created: boolean }> {
  if (course.catalogueKey) {
    const { data } = await client
      .from('courses')
      .select('id')
      .eq('user_id', userId)
      .eq('catalogue_key', course.catalogueKey)
      .maybeSingle();
    if (data) return { id: (data as { id: string }).id, created: false };
  }
  const { data, error } = await client
    .from('courses')
    .insert({
      user_id: userId,
      title: course.title.trim().slice(0, 300),
      provider: course.provider ?? null,
      source_url: course.sourceUrl ?? null,
      about: course.about ?? null,
      goal: course.goal?.trim() || null,
      budget_minutes: course.budgetMinutes ?? 180,
      catalogue_key: course.catalogueKey ?? null,
      status: 'queued',
      steps: freshSteps(),
    })
    .select('id')
    .single();
  if (error) throw new Error(`Queuing the course failed: ${error.message}`);
  return { id: (data as { id: string }).id, created: true };
}

/** A build nobody has touched for this long is handed out again. */
export const BUILD_STALE_MS = 90 * 60 * 1000;

/** Take the oldest queued course, or one whose build went quiet, for the routine's session. */
export async function takeCourse(
  client: LearnSupabaseClient,
  userId: string,
  courseId?: string,
): Promise<CourseSummary | null> {
  const stale = new Date(Date.now() - BUILD_STALE_MS).toISOString();
  let query = client.from('courses').select(SUMMARY_COLUMNS).eq('user_id', userId);
  query = courseId
    ? query.eq('id', courseId).in('status', ['queued', 'building', 'failed'])
    : query.or(`status.eq.queued,and(status.eq.building,updated_at.lt.${stale})`);
  const { data, error } = await query.order('requested_at').limit(1);
  if (error) throw new Error(`Reading the queue failed: ${error.message}`);
  const row = ((data ?? []) as Row[])[0];
  if (!row) return null;
  const now = new Date().toISOString();
  const steps =
    Array.isArray(row.steps) && (row.steps as BuildStep[]).length > 0
      ? (row.steps as BuildStep[])
      : freshSteps();
  const { error: failed } = await client
    .from('courses')
    .update({ status: 'building', taken_at: now, updated_at: now, error: null, steps })
    .eq('id', row.id as string)
    .eq('user_id', userId);
  if (failed) throw new Error(`Taking the course failed: ${failed.message}`);
  return readSummary({ ...row, status: 'building', taken_at: now, steps });
}

/** Report where the build is, so the course's page can show it. */
export async function reportStep(
  client: LearnSupabaseClient,
  userId: string,
  courseId: string,
  key: StepKey,
  state: StepState,
  detail: string | null,
): Promise<BuildStep[]> {
  const { data, error } = await client
    .from('courses')
    .select('steps')
    .eq('id', courseId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) throw new Error(`No course ${courseId} for the owner.`);
  const current =
    Array.isArray((data as Row).steps) && ((data as Row).steps as BuildStep[]).length > 0
      ? ((data as Row).steps as BuildStep[])
      : freshSteps();
  const now = new Date().toISOString();
  const at = BUILD_STEPS.findIndex((step) => step.key === key);
  const steps = current.map((step, index) => {
    if (step.key === key) return { ...step, state, detail, at: now };
    // Reporting a later stage settles the ones before it.
    if (index < at && step.state !== 'done')
      return { ...step, state: 'done' as const, at: step.at ?? now };
    return step;
  });
  const { error: failed } = await client
    .from('courses')
    .update({ steps, updated_at: now })
    .eq('id', courseId)
    .eq('user_id', userId);
  if (failed) throw new Error(`Reporting the step failed: ${failed.message}`);
  return steps;
}

/** Keep the series' videos, in the order given. Lectures already noted keep their notes. */
export async function saveLectures(
  client: LearnSupabaseClient,
  userId: string,
  courseId: string,
  input: unknown,
): Promise<{ ok: true; lectures: Lecture[] } | { ok: false; problems: string[] }> {
  const checked = checkLectures(input);
  if (!checked.ok) return checked;
  const rows = checked.lectures.map((lecture, position) => ({
    course_id: courseId,
    user_id: userId,
    code: lecture.code,
    position,
    title: lecture.title,
    speaker: lecture.speaker,
    video_id: lecture.videoId,
    duration_seconds: lecture.durationSeconds,
  }));
  const { error } = await client
    .from('course_lectures')
    .upsert(rows, { onConflict: 'course_id,code' });
  if (error) throw new Error(`Saving the lectures failed: ${error.message}`);
  const seconds = checked.lectures.reduce((sum, lecture) => sum + lecture.durationSeconds, 0);
  await client
    .from('courses')
    .update({
      totals: { videos: checked.lectures.length, runtimeMinutes: Math.round(seconds / 60) },
      updated_at: new Date().toISOString(),
    })
    .eq('id', courseId)
    .eq('user_id', userId);
  return checked;
}

/** Keep one lecture's notes file. */
export async function saveNotes(
  client: LearnSupabaseClient,
  userId: string,
  courseId: string,
  code: string,
  notes: string,
): Promise<void> {
  const body = notes.trim();
  if (body.length < 400)
    throw new Error(
      `The notes for ${code} are ${body.length} characters; a lecture's notes run to thousands.`,
    );
  const { data, error } = await client
    .from('course_lectures')
    .update({ notes: body, noted_at: new Date().toISOString() })
    .eq('course_id', courseId)
    .eq('user_id', userId)
    .eq('code', code)
    .select('code');
  if (error) throw new Error(`Saving the notes for ${code} failed: ${error.message}`);
  if (!data || data.length === 0) throw new Error(`The course has no lecture ${code}.`);
}

/** Lectures and which of them have notes, for the count check before synthesis (rule D4). */
export async function noteCounts(
  client: LearnSupabaseClient,
  userId: string,
  courseId: string,
): Promise<{ total: number; noted: number; missing: string[] }> {
  const { data, error } = await client
    .from('course_lectures')
    .select('code, noted_at')
    .eq('course_id', courseId)
    .eq('user_id', userId)
    .order('position');
  if (error) throw new Error(`Reading the lectures failed: ${error.message}`);
  const rows = (data ?? []) as { code: string; noted_at: string | null }[];
  const missing = rows.filter((row) => !row.noted_at).map((row) => row.code);
  return { total: rows.length, noted: rows.length - missing.length, missing };
}

/** Check the digest against the stored lectures and keep it. */
export async function saveDigest(
  client: LearnSupabaseClient,
  userId: string,
  courseId: string,
  input: unknown,
): Promise<{ ok: true; totals: CourseTotals } | { ok: false; problems: string[] }> {
  const lectures = await loadLectures(client, userId, courseId);
  if (lectures.length === 0)
    return {
      ok: false,
      problems: ['The course has no lectures stored; save the inventory first.'],
    };
  const counts = await noteCounts(client, userId, courseId);
  if (counts.missing.length > 0) {
    return {
      ok: false,
      problems: [
        `${counts.missing.length} of ${counts.total} lectures have no notes (${counts.missing.join(', ')}); a digest is built from every lecture.`,
      ],
    };
  }
  const checked = checkDigest(input, lectures);
  if (!checked.ok) return checked;
  const totals: CourseTotals = {
    ...digestTotals(checked.digest, lectures),
    videos: lectures.length,
  };
  const now = new Date().toISOString();
  const steps = freshSteps().map((step) => ({ ...step, state: 'done' as const, at: now }));
  const { error } = await client
    .from('courses')
    .update({
      digest: checked.digest,
      totals,
      status: 'ready',
      built_at: now,
      updated_at: now,
      error: null,
      steps,
    })
    .eq('id', courseId)
    .eq('user_id', userId);
  if (error) throw new Error(`Saving the digest failed: ${error.message}`);
  return { ok: true, totals };
}

export async function failCourse(
  client: LearnSupabaseClient,
  userId: string,
  courseId: string,
  why: string,
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await client
    .from('courses')
    .update({ status: 'failed', error: why.slice(0, 1000), updated_at: now })
    .eq('id', courseId)
    .eq('user_id', userId);
  if (error) throw new Error(`Recording the failure failed: ${error.message}`);
}

/** Put a failed course back in the queue. */
export async function requeueCourse(
  client: LearnSupabaseClient,
  userId: string,
  courseId: string,
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await client
    .from('courses')
    .update({ status: 'queued', error: null, requested_at: now, updated_at: now })
    .eq('id', courseId)
    .eq('user_id', userId)
    .eq('status', 'failed');
  if (error) throw new Error(`Queuing the course again failed: ${error.message}`);
}

/** Tick or untick a path clip or a lesson. */
export async function setProgress(
  client: LearnSupabaseClient,
  userId: string,
  courseId: string,
  kind: 'clips' | 'lessons',
  key: string,
  done: boolean,
): Promise<CourseProgress> {
  const { data, error } = await client
    .from('courses')
    .select('progress')
    .eq('id', courseId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) throw new Error('That course is not here.');
  const stored = ((data as Row).progress ?? {}) as Partial<CourseProgress>;
  const progress: CourseProgress = { clips: stored.clips ?? [], lessons: stored.lessons ?? [] };
  const kept = new Set(progress[kind]);
  if (done) kept.add(key);
  else kept.delete(key);
  progress[kind] = [...kept];
  const { error: failed } = await client
    .from('courses')
    .update({ progress })
    .eq('id', courseId)
    .eq('user_id', userId);
  if (failed) throw new Error(`Saving that failed: ${failed.message}`);
  return progress;
}

export { freshSteps };
