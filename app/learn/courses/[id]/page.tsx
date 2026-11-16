import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import { loadCourse } from '@/lib/learn/courses/store';
import { BuildView } from './build-view';
import { CourseView } from './course-view';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const course = await loadCourse(await createLearnClient(), user.id, id);
  return { title: course?.title ?? 'Course' };
}

/** One course: its digest once built (course-view.tsx), the build's stages until then (build-view.tsx). */
export default async function CoursePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; play?: string; t?: string }>;
}) {
  const [{ id }, { tab, play, t }] = await Promise.all([params, searchParams]);
  const user = await requireUser();
  const course = await loadCourse(await createLearnClient(), user.id, id);
  if (!course) notFound();
  if (course.status !== 'ready' || !course.digest) return <BuildView course={course} />;
  // A moment's link (linkMoments) names the lecture to open and the second to play from.
  const start = Number(t);
  return (
    <CourseView
      course={course}
      digest={course.digest}
      tab={tab ?? null}
      play={
        play
          ? { code: play, start: Number.isFinite(start) && start > 0 ? Math.floor(start) : 0 }
          : null
      }
    />
  );
}
