import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import { hasPlan } from '@/lib/learn/courses/digest';
import { afterStep, findStep } from '@/lib/learn/courses/plan';
import { loadCourse } from '@/lib/learn/courses/store';
import { LessonView } from './lesson-view';

export const dynamic = 'force-dynamic';

/** One step of a course's plan; lesson-view.tsx says how it is drawn. */
export default async function LessonPage({
  params,
}: {
  params: Promise<{ id: string; key: string }>;
}) {
  const { id, key } = await params;
  const user = await requireUser();
  const course = await loadCourse(await createLearnClient(), user.id, id);
  if (!course || !hasPlan(course.digest)) notFound();
  const plan = course.digest.plan;
  const stepKey = decodeURIComponent(key);
  const placed = findStep(plan, stepKey);
  if (!placed) notFound();
  return <LessonView course={course} placed={placed} next={afterStep(plan, stepKey)} />;
}
