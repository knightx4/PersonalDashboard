'use client';

import { useFormStatus } from 'react-dom';
import { PaidHint } from '@/components/ui/paid-hint';
import type { Concept } from '@/lib/learn/graph/model';
import { readAboutConcept } from './actions';

/**
 * Taking a gap to the reading queue.
 *
 * A gap is a better input to a search than a subject somebody typed, so this
 * sits next to the claim rather than on a form somewhere. Offered only where
 * it means something: a claim you are shaky on or actively wrong about.
 *
 * The subject page shows it on a card and the concept page shows it on its
 * own, and both send the same two ids to the same action.
 *
 * The press searches the catalogue before it queues anything, which takes a
 * few seconds rather than being instant, so the button says so while it runs.
 * Without that it reads as a button that did nothing, and a second press is a
 * second search.
 *
 * `anyState` drops the gate, for the screen of what to learn next: there the
 * row is already something you could start on, and a claim nothing is known
 * about is the most ordinary thing on it. On a subject's chain the gate stays,
 * or every node in a long graph grows a button nobody asked for.
 */
export function ReadAbout({
  concept,
  subjectId,
  anyState = false,
}: {
  concept: Concept;
  subjectId: string;
  anyState?: boolean;
}) {
  if (!anyState && concept.state !== 'shaky' && concept.state !== 'misconception') return null;

  return (
    <form action={readAboutConcept} className="flex items-center gap-1">
      <input type="hidden" name="conceptId" value={concept.id} />
      <input type="hidden" name="subjectId" value={subjectId} />
      <Submit />
      <PaidHint
        action="app/learn/s/[id]/actions.ts#readAboutConcept"
        what="Cost of the search"
      />
    </form>
  );
}

function Submit() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className="text-ui text-ink-muted underline-offset-2 hover:text-accent hover:underline disabled:hover:text-ink-muted disabled:hover:no-underline"
    >
      {pending ? 'Looking for something…' : 'Find something to read for this'}
    </button>
  );
}
