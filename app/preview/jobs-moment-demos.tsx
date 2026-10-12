'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { PipelineBoard, type BoardHandle } from '@/components/jobs/pipeline/board';
import { Button } from '@/components/ui/button';
import { ToastProvider } from '@/components/ui/toast';
import type { PipelineRow } from '@/lib/jobs/applications/load';
import type { ApplicationStatus } from '@/lib/jobs/pipeline';

/**
 * The three Jobs moments on the Pipeline board (plan #1596), played on demand
 * for `npm run record`. A recording is made at phone width, where the board
 * is a stack of folds and there is no drag, so the button makes the move
 * through the board's handle: the same path a drag or the reject button
 * takes, so the same moment plays. Nothing is written anywhere; the move is
 * kept in this component's rows, and a second press puts the card back.
 *
 * At a laptop's width the board scrolls sideways, so the demo opens scrolled
 * to the lane the card starts in, with the lane it goes to beside it. The
 * toast a rejection leaves needs its provider, which the app shell holds and
 * the gallery does not.
 */
export function BoardMomentDemo({
  rows,
  applicationId,
  to,
  label,
}: {
  rows: readonly PipelineRow[];
  /** The card that moves. */
  applicationId: string;
  to: ApplicationStatus;
  /** What the button says, naming the role and where it goes. */
  label: string;
}) {
  const board = useRef<BoardHandle>(null);
  const area = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState<PipelineRow[]>(() => [...rows]);
  const [visit, setVisit] = useState(0);
  const moved = shown.some((row) => row.applicationId === applicationId && row.status === to);

  useLayoutEffect(() => {
    const lane = area.current
      ?.querySelector(`[data-stage] [data-application-id="${CSS.escape(applicationId)}"]`)
      ?.closest<HTMLElement>('[data-stage]');
    const scroller = lane?.parentElement;
    if (!lane || !scroller) return;
    scroller.scrollLeft += lane.getBoundingClientRect().left - scroller.getBoundingClientRect().left;
  }, [applicationId, visit]);

  return (
    <ToastProvider>
      <div ref={area} className="space-y-4">
        <Button
          variant="secondary"
          size="sm"
          data-motion-demo="board-move"
          onClick={() => {
            if (!moved) {
              board.current?.move(applicationId, to);
              return;
            }
            setShown([...rows]);
            setVisit((n) => n + 1);
          }}
        >
          {moved ? 'Put it back' : label}
        </Button>
        <PipelineBoard
          key={visit}
          handle={board}
          rows={shown.filter((row) => row.status !== 'rejected')}
          write={async (id, status) => {
            setShown((current) =>
              current.map((row) => (row.applicationId === id ? { ...row, status } : row)),
            );
            return { error: null };
          }}
        />
      </div>
    </ToastProvider>
  );
}
