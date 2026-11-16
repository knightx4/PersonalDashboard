import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import { loadCourse } from '@/lib/learn/courses/store';
import { LessonView } from './lesson-view';

export const dynamic = 'force-dynamic';

/** One lesson of a course; lesson-view.tsx says how it is drawn. */
export default async function LessonPage({
  params,
}: {
  params: Promise<{ id: string; key: string }>;
}) {
  const { id, key } = await params;
  const user = await requireUser();
  const course = await loadCourse(await createLearnClient(), user.id, id);
  if (!course?.digest) notFound();
  const lessons = course.digest.lessons;
  const at = lessons.findIndex((lesson) => lesson.key === decodeURIComponent(key));
  if (at < 0) notFound();
  return (
    <LessonView
      course={course}
      lesson={lessons[at]}
      at={at}
      total={lessons.length}
      next={lessons[at + 1] ?? null}
    />
  );
}
