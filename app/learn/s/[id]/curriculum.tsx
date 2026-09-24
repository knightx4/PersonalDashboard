'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { ListOrdered } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PaidHint } from '@/components/ui/paid-hint';
import { Card } from '@/components/ui/card';
import { writeTrackCurriculum, type CurriculumState } from './actions';

function WriteButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" pending={pending}>
      <ListOrdered className="size-4" strokeWidth={2} aria-hidden />
      {pending ? 'Writing the curriculum…' : 'Write the curriculum'}
    </Button>
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
          A curriculum lays out the whole track as a fixed list of units, in the order they are
          learned. It is written once and does not change; you open one unit at a time and its ideas
          are laid out then. Takes about twenty seconds.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <WriteButton />
          <PaidHint
            action="app/learn/s/[id]/actions.ts#writeTrackCurriculum"
            what="Cost of writing the curriculum"
          />
          {state.error && <span className="text-ui text-danger">{state.error}</span>}
        </div>
      </form>
    </Card>
  );
}
