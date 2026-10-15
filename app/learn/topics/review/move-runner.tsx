'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/shell/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DashAction } from '@/components/ui/dash-action';
import { Meter } from '@/components/ui/meter';
import { sectionSubject } from '@/lib/core/section-path';
import { moveClaimsSubject, refreshMoveReview } from './actions';

/**
 * The review page's header and its one action (plan #2138.4): Move sends
 * each subject still on the claims graph to be moved, one call at a time,
 * and the box under the header says which one it is on and how far it has
 * got. A subject that fails is listed with its reason when the run ends, and
 * the next press tries it again.
 *
 * `shown` is for the gallery, which draws the run mid-way without pressing
 * anything.
 */

export type RunShown = { done: number; total: number; current: string };

export const MOVE_SUBJECT = { href: '/learn/topics/review', label: 'From the claims graph' };

export function MoveRunner({
  toMove,
  shown,
}: {
  /** The subjects still to move or that failed, in the order they are sent. */
  toMove: readonly { id: string; name: string }[];
  shown?: RunShown;
}) {
  const router = useRouter();
  const [run, setRun] = useState<RunShown | null>(shown ?? null);
  const [, startRefresh] = useTransition();
  const stopping = useRef(false);
  const [stopAsked, setStopAsked] = useState(false);

  async function start() {
    stopping.current = false;
    setStopAsked(false);
    const queue = [...toMove];
    for (let i = 0; i < queue.length; i += 1) {
      if (stopping.current) break;
      setRun({ done: i, total: queue.length, current: queue[i].name });
      try {
        await moveClaimsSubject(queue[i].id);
      } catch (error) {
        // Recorded on the subject's row when the action got that far; the
        // run carries on to the next one either way.
        console.error('[learn move]', error instanceof Error ? error.message : error);
      }
    }
    setRun(null);
    await refreshMoveReview();
    startRefresh(() => router.refresh());
  }

  const n = toMove.length;
  const action =
    n > 0 && !run ? (
      <DashAction
        size="sm"
        variant="primary"
        paid="app/learn/topics/review/actions.ts#moveClaimsSubject"
        count={n}
        what="Cost of moving the subjects"
        hintFirst
        onClick={() => void start()}
      >
        Move {n} {n === 1 ? 'subject' : 'subjects'}
      </DashAction>
    ) : undefined;

  return (
    <>
      <PageHeader
        subject={sectionSubject('/learn/topics', 'Topics', MOVE_SUBJECT)}
        title="From the claims graph"
        actions={action}
      />
      {run && (
        <Card padding="standard" className="mb-4" aria-live="polite" aria-busy>
          <div className="flex items-baseline justify-between gap-3">
            <p className="min-w-0 truncate text-ui text-ink">
              Moving <span className="font-medium">{run.current}</span>
            </p>
            <span className="tabular shrink-0 text-small text-ink-muted">
              {run.done} of {run.total} in this run
            </span>
          </div>
          <Meter
            value={run.done}
            max={run.total}
            label={`${run.done} of ${run.total} subjects moved`}
            moves
            className="mt-2"
          />
          <div className="mt-2 flex items-center justify-between gap-3">
            <p className="text-small text-ink-muted">
              {stopAsked ? 'Stopping after this subject.' : 'Each subject takes Dash up to a minute. Keep this page open.'}
            </p>
            {!stopAsked && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  stopping.current = true;
                  setStopAsked(true);
                }}
              >
                Stop
              </Button>
            )}
          </div>
        </Card>
      )}
    </>
  );
}
