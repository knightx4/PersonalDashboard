import { SectionHeading } from '@/components/ui/section-heading';
import type { SchoolGroup } from '@/lib/you/education';
import { AddTranscript } from './add-transcript';
import { SchoolCourses } from './course-list';

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
}: {
  groups: SchoolGroup[];
  courseCounts: Record<string, number>;
  transcripts: number;
  courses: number;
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
        <SchoolCourses key={group.school} group={group} courseCounts={courseCounts} />
      ))}
    </section>
  );
}
