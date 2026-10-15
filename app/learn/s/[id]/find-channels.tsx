'use client';

import { useActionState } from 'react';
import { DashAction } from '@/components/ui/dash-action';
import type { ChannelsPressState } from '@/lib/learn/youtube/subject-channels';
import { findSubjectChannels } from './actions';

/**
 * The Find channels button and what the last press did (plan #1199).
 *
 * A press can take a few minutes: the search, then three transcripts and a
 * verdict for each channel. What it did stays beside the button until the
 * next press, with what stopped it in red.
 */
export function FindChannels({ subjectId, found }: { subjectId: string; found: boolean }) {
  const [state, run, pending] = useActionState<ChannelsPressState, FormData>(findSubjectChannels, {});

  return (
    <form action={run} className="mb-3">
      <input type="hidden" name="subjectId" value={subjectId} />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <DashAction
          type="submit"
          size="sm"
          variant="secondary"
          pending={pending}
          paid="app/learn/s/[id]/actions.ts#findSubjectChannels"
          what="Cost of finding and judging channels"
        >
          {pending ? 'Finding and judging channels…' : found ? 'Find more channels' : 'Find channels'}
        </DashAction>
      </div>
      {(state.lines?.length || state.error) && (
        <div className="mt-2 space-y-1 text-small" aria-live="polite">
          {state.lines?.map((line) => (
            <p key={line} className="text-ink-muted">
              {line}
            </p>
          ))}
          {state.error && (
            <p role="alert" className="text-danger">
              {state.error}
            </p>
          )}
        </div>
      )}
    </form>
  );
}
