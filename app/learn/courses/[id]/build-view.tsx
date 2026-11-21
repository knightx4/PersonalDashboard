import { Check, Circle, CircleAlert } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { PageColumn } from '@/components/shell/page-width';
import { Card } from '@/components/ui/card';
import { LiveDot } from '@/components/ui/live-dot';
import { sectionSubject } from '@/lib/core/section-path';
import { BUILD_STALE_MS, freshSteps, type BuildStep } from '@/lib/learn/courses/build';
import type { Course } from '@/lib/learn/courses/store';
import { hours } from '../format';
import { BuildActions, BuildRefresh } from './build-live';

/**
 * A course that is not built yet. The build runs in a routine and can take
 * an hour, so the page says which stage it is on and how far through, and
 * reloads itself while it waits (build-live.tsx). Nothing here is a spinner
 * with no words: each stage is named, and the one running carries its count.
 */
export function BuildView({ course }: { course: Course }) {
  const steps = course.steps.length > 0 ? course.steps : freshSteps();
  const open = course.status === 'queued' || course.status === 'building';
  return (
    <PageColumn className="space-y-5">
      <PageHeader
        subject={sectionSubject('/learn/courses', 'Courses', {
          label: course.title,
          href: `/learn/courses/${course.id}`,
        })}
        title={course.title}
        description={[
          course.provider,
          course.totals.videos ? `${course.totals.videos} videos` : null,
          course.totals.runtimeMinutes ? hours(course.totals.runtimeMinutes) : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      />

      <Card padding="dense" className="space-y-4">
        <p className="text-body text-ink">{headline(course)}</p>
        <ol className="space-y-3">
          {steps.map((step) => (
            <li key={step.key} className="flex items-start gap-3">
              <StepMark step={step} live={course.status === 'building'} />
              <span className="min-w-0 flex-1">
                <span
                  className={
                    step.state === 'waiting'
                      ? 'block text-ui text-ink-muted'
                      : 'block text-ui text-ink'
                  }
                >
                  {step.label}
                </span>
                {step.detail && (
                  <span className="tabular block text-small text-ink-muted [overflow-wrap:anywhere]">
                    {step.detail}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ol>
        {course.status === 'failed' && course.error && (
          <p className="text-small text-caution [overflow-wrap:anywhere]">{course.error}</p>
        )}
        <BuildActions courseId={course.id} status={course.status} quiet={isQuiet(course)} />
      </Card>

      {course.goal && (
        <p className="text-small text-ink-muted [overflow-wrap:anywhere]">
          Built for: {course.goal}
        </p>
      )}
      {open && <BuildRefresh />}
    </PageColumn>
  );
}

/** A build that has not reported for BUILD_STALE_MS, so its session has most likely stopped. */
function isQuiet(course: Course): boolean {
  if (course.status !== 'building' || !course.updatedAt) return false;
  return Date.now() - new Date(course.updatedAt).getTime() > BUILD_STALE_MS;
}

function headline(course: Course): string {
  if (course.status === 'failed') return 'The build stopped before the course was ready.';
  if (course.status === 'queued')
    return 'Waiting for Dash to start. Dash reads every lecture in full, so a long series takes an hour or more. You can leave this page.';
  return 'Dash is building this course. It reads every lecture in full, so a long series takes an hour or more. You can leave this page.';
}

function StepMark({ step, live }: { step: BuildStep; live: boolean }) {
  if (step.state === 'done')
    return (
      <Check
        className="mt-0.5 size-4 shrink-0 text-positive"
        strokeWidth={1.75}
        aria-label="Done"
      />
    );
  if (step.state === 'failed')
    return (
      <CircleAlert
        className="mt-0.5 size-4 shrink-0 text-caution"
        strokeWidth={1.75}
        aria-label="Stopped"
      />
    );
  if (step.state === 'running') {
    return (
      <span className="mt-1 flex size-4 shrink-0 items-center justify-center" aria-label="Running">
        <LiveDot still={!live} />
      </span>
    );
  }
  return (
    <Circle
      className="mt-0.5 size-4 shrink-0 text-ink-ghost"
      strokeWidth={1.75}
      aria-label="Waiting"
    />
  );
}
