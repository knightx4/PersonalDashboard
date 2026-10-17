import { PageColumn } from '@/components/shell/page-width';
import { PageHeader } from '@/components/shell/page-header';
import { requireUser } from '@/lib/auth/server';
import { createYouClient } from '@/lib/you/auth/server';
import { groupCourses } from '@/lib/you/education';
import type { Course, Transcript } from '@/lib/you/transcripts';
import { createClient as createJobsClient } from '@/lib/jobs/auth/server';
import { resumeHash } from '@/lib/you/resume-hash';
import { resumeChanged, sortJobs, type Job, type ResumeChoice } from '@/lib/you/work-history';
import { EducationSection } from './education-section';
import { JobsSection } from './jobs-section';
import { sectionSubject } from '@/lib/core/section-path';
import { createLearnClient } from '@/lib/learn/auth/server';
import { loadCourseExplains } from '@/lib/learn/evidence/course-explain-store';

export const metadata = { title: 'Work & school' };

export const dynamic = 'force-dynamic';

/**
 * You's Work & school tab: your jobs, read from your default résumé in Jobs
 * (plan #1991.4), above Education, which moved here from the Vault (plan
 * #1991.3): your transcripts and every course on them. Read on the session
 * client, so RLS keeps it to your own. The old /vault/education address
 * redirects here (next.config.ts), anchors and all.
 */
export default async function Page() {
  const you = await createYouClient();
  const user = await requireUser();
  const jobsClient = await createJobsClient();
  const [transcripts, courses, jobs, resume] = await Promise.all([
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
    you
      .from('work_history')
      .select('*')
      .then(({ data, error }) => {
        if (error) throw new Error(`Loading jobs failed: ${error.message}`);
        return (data ?? []) as Job[];
      }),
    // The résumé a read takes: the default, or the newest with text when none is marked.
    jobsClient
      .from('resume_versions')
      .select('id, label, text_content')
      .eq('user_id', user.id)
      .not('text_content', 'is', null)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        const row = data as { id: string; label: string; text_content: string | null } | null;
        return row?.text_content?.trim() ? { id: row.id, label: row.label, text: row.text_content } : null;
      }),
  ]);

  // The explain prompt on each graded course named for its topics (plan
  // #2172.4.2). A failed read leaves the rows without it rather than the tab blank.
  const explains = await loadCourseExplains(await createLearnClient(), courses).catch((error: unknown) => {
    console.error('[you work] course explains', error instanceof Error ? error.message : error);
    return {};
  });

  const courseCounts: Record<string, number> = {};
  for (const course of courses) courseCounts[course.transcript_id] = (courseCounts[course.transcript_id] ?? 0) + 1;

  const resumeChoice: ResumeChoice | null = resume ? { id: resume.id, label: resume.label, hash: resumeHash(resume.text) } : null;

  return (
    <PageColumn>
      <PageHeader subject={sectionSubject('/you/work', 'Work & school')} title="Work & school" />
      <JobsSection
        jobs={sortJobs(jobs)}
        resume={resumeChoice ? { label: resumeChoice.label } : null}
        changed={resumeChanged(resumeChoice, jobs)}
      />
      <EducationSection
        groups={groupCourses(transcripts, courses)}
        courseCounts={courseCounts}
        transcripts={transcripts.length}
        courses={courses.length}
        explains={explains}
      />
    </PageColumn>
  );
}
