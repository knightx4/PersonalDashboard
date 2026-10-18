import { SectionHeading } from '@/components/ui/section-heading';
import type { CourseExplain } from '@/lib/learn/evidence/course-explain';
import type { SchoolGroup } from '@/lib/you/education';
import { AddTranscript } from './add-transcript';
import { SchoolCourses, type FilesOpen } from './course-list';
import type { CourseFile, CourseWeek } from '@/lib/you/transcripts';

/**
 * Education on You's Work & school tab (plan #1991.3, moved from the Vault):
 * your transcripts and every course on them, by school and then by term,
 * newest term first. Drawn the same by the page and the gallery, so the
 * gallery shows what the page does.
 *
 * Under its own heading because the tab will also list your jobs (#1991.4).
 */
export function EducationSection({
  groups,
  courseCounts,
  transcripts,
  courses,
  explains,
  explaining,
  files,
  weeks,
  filesOpen,
}: {
  groups: SchoolGroup[];
  courseCounts: Record<string, number>;
  transcripts: number;
  courses: number;
  /** Each graded course's explain prompt or what its answer showed (plan #2172.4.2). */
  explains?: Record<string, CourseExplain>;
  /** The gallery's way to draw one course with its prompt open. */
  explaining?: string;
  /** The files kept under each course, by course id (plan #2401.2). */
  files?: Record<string, CourseFile[]>;
  /** The weeks laid out from each course's syllabus, by course id (plan #2401.6). */
  weeks?: Record<string, CourseWeek[]>;
  /** The gallery's way to draw one course with its files open. */
  filesOpen?: FilesOpen;
}) {
  return (
    <section aria-labelledby="education">
      <SectionHeading
        id="education"
        title="Education"
        count={
          transcripts > 0
            ? `${courses} ${courses === 1 ? 'course' : 'courses'} from ${transcripts} ${transcripts === 1 ? 'transcript' : 'transcripts'}`
            : undefined
        }
        className="mb-2"
      />
      <AddTranscript empty={transcripts === 0} />
      {groups.map((group) => (
        <SchoolCourses
          key={group.school}
          group={group}
          courseCounts={courseCounts}
          explains={explains}
          explaining={explaining}
          files={files}
          weeks={weeks}
          filesOpen={filesOpen}
        />
      ))}
    </section>
  );
}
