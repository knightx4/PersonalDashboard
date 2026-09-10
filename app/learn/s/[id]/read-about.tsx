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
 */
export function ReadAbout({ concept, subjectId }: { concept: Concept; subjectId: string }) {
  if (concept.state !== 'shaky' && concept.state !== 'misconception') return null;

  return (
    <form action={readAboutConcept}>
      <input type="hidden" name="conceptId" value={concept.id} />
      <input type="hidden" name="subjectId" value={subjectId} />
      <button
        type="submit"
        className="text-ui text-ink-muted underline-offset-2 hover:text-accent hover:underline"
      >
        Find something to read for this
      </button>
    </form>
  );
}
