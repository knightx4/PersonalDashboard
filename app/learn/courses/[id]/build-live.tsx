'use client';

import { useEffect, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import type { CourseStatus } from '@/lib/learn/courses/build';
import { resumeBuild, retryCourse, startWaitingCourse } from '../actions';

/** Reload the page's data every few seconds while a build is open, so the stages move without a press. */
export function BuildRefresh() {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh();
    }, 8000);
    return () => clearInterval(timer);
  }, [router]);
  return null;
}

/**
 * Try a stopped build again, start one that has been waiting, or resume one
 * that went quiet (its session ended or met a usage limit): what it kept is
 * kept, and the routine picks up from there.
 */
export function BuildActions({
  courseId,
  status,
  quiet,
}: {
  courseId: string;
  status: CourseStatus;
  /** The build has not reported for BUILD_STALE_MS. */
  quiet: boolean;
}) {
  const [pending, start] = useTransition();
  if (status === 'failed') {
    return (
      <Button
        type="button"
        variant="secondary"
        pending={pending}
        onClick={() => start(() => retryCourse(courseId))}
      >
        Try again
      </Button>
    );
  }
  if (status === 'building' && quiet) {
    return (
      <div className="space-y-2">
        <p className="text-small text-ink-muted">
          Nothing has moved for a while. The build may have stopped at a usage limit; what it
          finished is kept.
        </p>
        <Button
          type="button"
          variant="secondary"
          pending={pending}
          onClick={() => start(() => resumeBuild(courseId))}
        >
          Resume the build
        </Button>
      </div>
    );
  }
  if (status === 'queued') {
    return (
      <Button
        type="button"
        variant="secondary"
        pending={pending}
        onClick={() => start(() => startWaitingCourse(courseId))}
      >
        Start it now
      </Button>
    );
  }
  return null;
}
