import { requireUser } from '@/lib/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import { COURSE_CATALOGUE } from '@/lib/learn/courses/catalogue';
import { loadCourses } from '@/lib/learn/courses/store';
import { CoursesView } from './courses-view';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Courses' };

/** The courses Dash has cut down for you, and the open ones it can build; courses-view.tsx says how they are drawn. */
export default async function CoursesPage() {
  const user = await requireUser();
  const supabase = await createLearnClient();
  const courses = await loadCourses(supabase, user.id);
  const have = new Set(courses.map((course) => course.catalogueKey).filter(Boolean));
  const catalogue = COURSE_CATALOGUE.filter((course) => !have.has(course.key));
  return <CoursesView courses={courses} catalogue={catalogue} />;
}
