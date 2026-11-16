'use client';

import { useOptimistic, useTransition } from 'react';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { markCourseProgress } from '../actions';

/** Mark a step of the plan done. Shown pressed at once; the row is saved behind it. */
export function Tick({
  courseId,
  kind,
  itemKey,
  done,
  label,
}: {
  courseId: string;
  kind: 'clips' | 'lessons';
  itemKey: string;
  done: boolean;
  label: string;
}) {
  const [shown, setShown] = useOptimistic(done);
  const [, start] = useTransition();
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      pressed={shown}
      aria-pressed={shown}
      className="shrink-0"
      onClick={() =>
        start(async () => {
          setShown(!shown);
          await markCourseProgress(courseId, kind, itemKey, !shown);
        })
      }
    >
      {shown && <Check className="size-3.5" strokeWidth={1.75} aria-hidden />}
      {label}
    </Button>
  );
}
