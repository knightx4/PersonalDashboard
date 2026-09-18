'use client';

import { Columns3, Rows3 } from 'lucide-react';
import { Segmented } from '@/components/ui/segmented';
import { useOptimisticWrite } from '@/lib/use-optimistic-write';
import type { PipelineView } from '@/components/jobs/pipeline/board';
import { setPipelineView } from '@/app/jobs/(app)/pipeline/actions';

const VIEWS = [
  { value: 'board' as const, label: 'Board', icon: <Columns3 className="size-3.5" strokeWidth={1.75} aria-hidden /> },
  { value: 'list' as const, label: 'List', icon: <Rows3 className="size-3.5" strokeWidth={1.75} aria-hidden /> },
];

/**
 * Board or list, remembered.
 *
 * Optimistic because the write is a preference on the profile and the redraw
 * comes back through revalidation: without it the pressed segment would stay
 * unpressed for a round trip, which reads as the button not working. The
 * failing half of that -- putting the segment back, and saying why -- comes
 * from useOptimisticWrite rather than from here.
 *
 * The control itself is the shared `Segmented`. This used to draw its own
 * bordered box at a hand-written 32px, which is one density's answer written
 * down as if it were every density's: on a phone the dial gives controls 36px
 * for a thumb and this stayed 32, and at the dense setting everything beside it
 * came down to 28 and this stayed 32 again.
 */
export function PipelineViewToggle({ view }: { view: PipelineView }) {
  const { shown, run, pending } = useOptimisticWrite<PipelineView, PipelineView>({
    value: view,
    apply: (_current, next) => next,
    write: setPipelineView,
  });

  return (
    <Segmented
      label="Pipeline view"
      value={shown}
      options={VIEWS}
      disabled={pending}
      onChange={run}
    />
  );
}
