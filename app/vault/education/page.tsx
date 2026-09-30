import { PageHeader } from '@/components/shell/page-header';
import { createVaultClient } from '@/lib/vault/auth/server';
import { groupCourses } from '@/lib/vault/education';
import type { Course, Transcript } from '@/lib/vault/transcripts';
import { AddTranscript } from './add-transcript';
import { SchoolCourses } from './course-list';

export const dynamic = 'force-dynamic';

/**
 * The Education tab (plan #1308, under #1304): your academic transcripts and
 * every course on them, by school and then by term, newest term first. Read
 * on the session client, so RLS keeps it to your own.
 */
export default async function EducationPage() {
  const vault = await createVaultClient();
  const [transcripts, courses] = await Promise.all([
    vault
      .from('transcripts')
      .select('*')
      .order('uploaded_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) throw new Error(`Loading transcripts failed: ${error.message}`);
        return (data ?? []) as Transcript[];
      }),
    vault
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

  const groups = groupCourses(transcripts, courses);
  const courseCounts: Record<string, number> = {};
  for (const course of courses) courseCounts[course.transcript_id] = (courseCounts[course.transcript_id] ?? 0) + 1;

  return (
    <>
      <PageHeader
        title="Education"
        description={
          transcripts.length > 0
            ? `${courses.length} ${courses.length === 1 ? 'course' : 'courses'} from ${transcripts.length} ${transcripts.length === 1 ? 'transcript' : 'transcripts'}`
            : undefined
        }
      />
      <AddTranscript empty={transcripts.length === 0} />
      {groups.map((group) => (
        <SchoolCourses key={group.school} group={group} courseCounts={courseCounts} />
      ))}
    </>
  );
}
