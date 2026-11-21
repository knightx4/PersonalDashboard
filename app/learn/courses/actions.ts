'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import { playlistIdOf } from '@/lib/learn/courses/build';
import { catalogueCourse } from '@/lib/learn/courses/catalogue';
import { fireCourseRoutine, requestCourse } from '@/lib/learn/courses/request';
import { requeueCourse, resumeCourse, setProgress } from '@/lib/learn/courses/store';

/**
 * What the Courses tab can do. Asking for a course queues it for the routine
 * (lib/learn/courses/request.ts); none of these calls a model.
 */

export type AddCourseState = { error?: string };

/** Build a course from the catalogue. */
// latency: pending
export async function buildCatalogueCourse(key: string): Promise<void> {
  const user = await requireUser();
  const course = catalogueCourse(key);
  if (!course) throw new Error('That course is not in the catalogue.');
  const supabase = await createLearnClient();
  const request = await requestCourse(supabase, user.id, {
    title: course.title,
    provider: course.provider,
    about: course.about,
    sourceUrl: course.sourceUrl ?? null,
    catalogueKey: course.key,
  });
  revalidatePath('/learn/courses');
  redirect(`/learn/courses/${request.id}`);
}

/** Build a course from a playlist address or a name, with what the person wants from it. */
// latency: pending
export async function addCourse(
  _prev: AddCourseState,
  formData: FormData,
): Promise<AddCourseState> {
  const user = await requireUser();
  const what = String(formData.get('what') ?? '').trim();
  const goal = String(formData.get('goal') ?? '').trim();
  if (!what) return { error: 'Paste a playlist link or name the course.' };
  if (what.length > 300) return { error: 'That is too long for a course name.' };
  const isLink = /^https?:\/\//i.test(what);
  if (isLink && !playlistIdOf(what)) {
    return {
      error:
        "That link is not a YouTube playlist. Paste the playlist's address, or name the course and Dash will find it.",
    };
  }
  const supabase = await createLearnClient();
  const request = await requestCourse(supabase, user.id, {
    title: isLink ? 'A course from a playlist' : what,
    sourceUrl: isLink ? what : null,
    goal: goal || null,
  });
  revalidatePath('/learn/courses');
  redirect(`/learn/courses/${request.id}`);
}

/** Put a failed course back in the queue and start the routine. */
// latency: pending
export async function retryCourse(courseId: string): Promise<void> {
  const user = await requireUser();
  const supabase = await createLearnClient();
  await requeueCourse(supabase, user.id, courseId);
  await fireCourseRoutine(supabase, user.id);
  revalidatePath(`/learn/courses/${courseId}`);
}

/** Put a build that went quiet back in the queue, keeping what it kept, and start the routine. */
// latency: pending
export async function resumeBuild(courseId: string): Promise<void> {
  const user = await requireUser();
  const supabase = await createLearnClient();
  await resumeCourse(supabase, user.id, courseId);
  await fireCourseRoutine(supabase, user.id);
  revalidatePath(`/learn/courses/${courseId}`);
}

/** Start the routine on a course that has been waiting. */
// latency: pending
export async function startWaitingCourse(courseId: string): Promise<void> {
  const user = await requireUser();
  const supabase = await createLearnClient();
  await fireCourseRoutine(supabase, user.id);
  revalidatePath(`/learn/courses/${courseId}`);
}

/** Tick a step of a course's plan done. */
// latency: optimistic
export async function markCourseProgress(
  courseId: string,
  kind: 'clips' | 'lessons',
  key: string,
  done: boolean,
): Promise<void> {
  const user = await requireUser();
  const supabase = await createLearnClient();
  await setProgress(supabase, user.id, courseId, kind, key, done);
  revalidatePath(`/learn/courses/${courseId}`);
}
