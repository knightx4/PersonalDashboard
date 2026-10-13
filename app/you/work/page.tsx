import { PageHeader } from '@/components/shell/page-header';
import { requireUser } from '@/lib/auth/server';
import { createYouClient } from '@/lib/you/auth/server';
import { groupCourses } from '@/lib/you/education';
import type { Course, Transcript } from '@/lib/you/transcripts';
import { EducationSection } from './education-section';

export const metadata = { title: 'Work & school' };

export const dynamic = 'force-dynamic';

/**
 * You's Work & school tab. Education moved here from the Vault (plan
 * #1991.3): your transcripts and every course on them. Read on the session
 * client, so RLS keeps it to your own. The old /vault/education address
 * redirects here (next.config.ts), anchors and all.
 */
export default async function Page() {
  await requireUser();
  const you = await createYouClient();
  const [transcripts, courses] = await Promise.all([
    you
      .from('transcripts')
      .select('*')
      .order('uploaded_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) throw new Error(`Loading transcripts failed: ${error.message}`);
        return (data ?? []) as Transcript[];
      }),
    you
      .from('courses')
      .select('*')
      .order('position')
      .then(({ data, error }) => {
        if (error) throw new Error(`Loading courses failed: ${error.message}`);
        // numeric comes back as a number from PostgREST, but a string would not survive the sum.
        return ((data ?? []) as Course[]).map((course) => ({
          ...course,
          credits: course.credits === null ? null : Number(course.credits),
        }));
      }),
  ]);

  const courseCounts: Record<string, number> = {};
  for (const course of courses) courseCounts[course.transcript_id] = (courseCounts[course.transcript_id] ?? 0) + 1;

  return (
    <>
      <PageHeader title="Work & school" />
      <EducationSection
        groups={groupCourses(transcripts, courses)}
        courseCounts={courseCounts}
        transcripts={transcripts.length}
        courses={courses.length}
      />
    </>
  );
}
