'use client';

import { useActionState } from 'react';
import { Banner } from '@/components/ui/banner';
import { DashAction } from '@/components/ui/dash-action';
import { writeYearReview, type WriteYearState } from '../../actions';

/**
 * "Write the review", or "Write it again" for the year being lived in (plan
 * #1121). A form, so it posts without JavaScript too; the page comes back
 * with the review once it is stored. A run that fails leaves whatever was
 * stored before and says why.
 */
export function WriteYearButton({ year, again }: { year: number; again: boolean }) {
  const [state, run, pending] = useActionState<WriteYearState, FormData>(writeYearReview, { status: 'idle' });
  return (
    <div className="space-y-2">
      <form action={run} className="flex items-center gap-1">
        <input type="hidden" name="year" value={year} />
        <DashAction
          type="submit"
          size="sm"
          variant="secondary"
          pending={pending}
          paid="app/timeline/actions.ts#writeYearReview"
          what="Cost of writing the review"
          hintFirst
        >
          {pending ? 'Writing…' : again ? 'Write it again' : 'Write the review'}
        </DashAction>
      </form>
      {state.status === 'failed' && !pending && <Banner tone="bad">{state.message}</Banner>}
    </div>
  );
}
