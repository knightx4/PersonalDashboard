'use client';

import { useEffect, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import type { CourseStatus } from '@/lib/learn/courses/build';
import { retryCourse, startWaitingCourse } from '../actions';

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

/** Try a stopped build again, or start one that has been waiting. */
export function BuildActions({ courseId, status }: { courseId: string; status: CourseStatus }) {
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
