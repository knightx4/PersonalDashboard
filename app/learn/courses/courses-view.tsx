import Link from '@/components/ui/link';
import { Presentation } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { PageColumn } from '@/components/shell/page-width';
import { Card } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { EmptyState } from '@/components/ui/empty-state';
import { LiveDot } from '@/components/ui/live-dot';
import { SectionHeading } from '@/components/ui/section-heading';
import { sectionSubject } from '@/lib/core/section-path';
import { CATALOGUE_AREAS, type CatalogueCourse } from '@/lib/learn/courses/catalogue';
import type { CourseSummary } from '@/lib/learn/courses/store';
import { AddCourse } from './add-course';
import { BuildButton } from './build-button';
import { hours, runningStep } from './format';

/**
 * The Courses tab (docs/LEARN-DIGEST-SPEC.md). A course here is a long
 * lecture series cut down to what this person needs: one plan of lessons to
 * take in order, branching where the course forks, with the clips worth
 * watching inside it, and what the lecturers got wrong.
 *
 * Yours first, with a course that is being built showing the stage it is on.
 * Then the box that takes any playlist, then the open courses Dash can build,
 * grouped by what they are about. Building one costs nothing: it is done in a
 * routine on the Claude subscription, never through the API.
 */
export function CoursesView({
  courses,
  catalogue,
}: {
  courses: CourseSummary[];
  catalogue: CatalogueCourse[];
}) {
  return (
    <PageColumn className="space-y-8">
      <PageHeader subject={sectionSubject('/learn/courses', 'Courses')} title="Courses" />

      {courses.length === 0 ? (
        <EmptyState
          icon={Presentation}
          title="No courses yet"
          description="A course is a long lecture series cut down to the hours that matter to you. Pick one below, or paste any YouTube playlist."
        />
      ) : (
        <Card padding="none">
          <ul className="divide-y divide-border">
            {courses.map((course) => (
              <li key={course.id}>
                <Link
                  href={`/learn/courses/${course.id}`}
                  className="card-pad-x row-pad flex min-h-11 items-center gap-3 transition-colors duration-quick hover:bg-sunken"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-ui font-medium text-ink [overflow-wrap:anywhere]">
                      {course.title}
                    </span>
                    <span className="block text-small text-ink-muted [overflow-wrap:anywhere]">
                      {courseLine(course)}
                    </span>
                  </span>
                  <CourseState course={course} />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <section aria-label="Add a course" className="space-y-3">
        <SectionHeading title="Build one from any playlist" />
        <AddCourse />
      </section>

      {catalogue.length > 0 && (
        <section aria-label="Open courses" className="space-y-3">
          <SectionHeading title="Open courses Dash can build" count={catalogue.length} />
          <Card padding="none" className="divide-y divide-border">
            {CATALOGUE_AREAS.map((area) => {
              const rows = catalogue.filter((course) => course.area === area);
              if (rows.length === 0) return null;
              return (
                <div key={area}>
                  <h3 className="card-pad-x bg-sunken py-1.5 text-small font-medium text-ink-muted">
                    {area}
                  </h3>
                  <ul className="divide-y divide-border">
                    {rows.map((course) => (
                      <li key={course.key} className="card-pad-x row-pad flex items-center gap-3">
                        <span className="min-w-0 flex-1">
                          <span className="block text-ui font-medium text-ink [overflow-wrap:anywhere]">
                            {course.title}
                          </span>
                          <span className="block text-small text-ink-muted [overflow-wrap:anywhere]">
                            {course.provider}. {course.about}
                          </span>
                        </span>
                        <BuildButton courseKey={course.key} />
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </Card>
        </section>
      )}
    </PageColumn>
  );
}

/** The line under a course's name: what it comes to once built, or where it stands. */
function courseLine(course: CourseSummary): string {
  const by = course.provider ? `${course.provider} · ` : '';
  if (course.status === 'ready') {
    const { runtimeMinutes, pathMinutes, videos } = course.totals;
    const taken = course.progress.lessons.length;
    const parts = [
      videos ? `${videos} videos` : null,
      runtimeMinutes ? `${hours(runtimeMinutes)} as about ${hours(pathMinutes ?? 0)} of lessons` : null,
      taken > 0 ? `${taken} ${taken === 1 ? 'step' : 'steps'} done` : null,
    ].filter(Boolean);
    return by + parts.join(' · ');
  }
  if (course.status === 'failed') return `${by}${course.error ?? 'The build stopped.'}`;
  const step = runningStep(course.steps);
  if (course.status === 'building' && step)
    return `${by}${step.label}${step.detail ? `, ${step.detail}` : ''}`;
  return `${by}Waiting for Dash to start`;
}

function CourseState({ course }: { course: CourseSummary }) {
  if (course.status === 'ready') return null;
  if (course.status === 'failed') return <Chip tone="caution">Stopped</Chip>;
  return (
    <span className="flex shrink-0 items-center gap-2 text-small text-ink-muted">
      <LiveDot
        tone={course.status === 'building' ? 'accent' : 'muted'}
        still={course.status !== 'building'}
      />
      {course.status === 'building' ? 'Building' : 'Queued'}
    </span>
  );
}
