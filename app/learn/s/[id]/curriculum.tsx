'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { DashAction } from '@/components/ui/dash-action';
import { Card } from '@/components/ui/card';
import { writeTrackCurriculum, type CurriculumState } from './actions';

function WriteButton() {
  const { pending } = useFormStatus();
  return (
    <DashAction
      type="submit"
      variant="primary"
      pending={pending}
      paid="app/learn/s/[id]/actions.ts#writeTrackCurriculum"
      what="Cost of writing the curriculum"
    >
      {pending ? 'Writing the curriculum…' : 'Write the curriculum'}
    </DashAction>
  );
}

/**
 * The way to a curriculum for a track that has none: one made before tracks
 * had them, one started from a Learn now card or a briefing, or one whose
 * first attempt failed. Written once, then fixed.
 */
export function WriteCurriculum({ subjectId }: { subjectId: string }) {
  const [state, write] = useActionState<CurriculumState, FormData>(writeTrackCurriculum, {});

  return (
    <Card padding="standard" className="mb-6">
      <form action={write}>
        <input type="hidden" name="subjectId" value={subjectId} />
        <h2 className="text-body font-semibold text-ink">No curriculum yet</h2>
        <p className="mt-1 text-ui text-ink-muted">
          A curriculum lays out the whole subject as a fixed list of units, in the order they are
          learned. It is written once and does not change; you open one unit at a time and its ideas
          are laid out then. Takes about twenty seconds.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <WriteButton />
          {state.error && <span className="text-ui text-danger">{state.error}</span>}
        </div>
      </form>
    </Card>
  );
}

/**
 * Where the curriculum will be while the subject is being prepared: the
 * preparation writes the opening units at its own step, so there is nothing
 * to press yet (plan #2276.9).
 */
export function CurriculumComing({ position, total }: { position: number; total: number }) {
  return (
    <section className="mb-6">
      <h2 className="mb-2 text-ui font-semibold text-ink-muted">Curriculum</h2>
      <Card padding="dense">
        <p className="text-ui text-ink-muted">
          The opening units are written at step {position} of {total}, once the topics are drafted.
        </p>
      </Card>
    </section>
  );
}
