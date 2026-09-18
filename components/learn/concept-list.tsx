import Link from 'next/link';
import { cardVariants } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import {
  ESTABLISHED_LABEL,
  LastChecked,
  STATE_LABEL,
  StateMark,
} from '@/components/learn/concept-state';
import { ReadAbout } from '@/app/learn/s/[id]/read-about';
import type { Concept } from '@/lib/learn/graph/model';

/**
 * A subject's concepts, doors first.
 *
 * Its own file rather than a helper inside the subject page, because the page
 * renders it three times -- once per goal, and once for the whole graph -- and
 * because a surface with a layout rule in it is one the gallery can be shown.
 */

export function ConceptRow({
  concept,
  next,
  subjectId,
  timezone,
}: {
  concept: Concept;
  next: boolean;
  subjectId: string;
  timezone: string;
}) {
  // A door is drawn bigger than what follows from it. The size is the whole
  // point of the mark on this page: forty rows at one weight say every claim
  // in the subject is the same size, and they are not.
  const door = concept.kind === 'threshold';

  return (
    <li className="flex gap-3 px-4 py-3">
      <StateMark concept={concept} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <Link
            href={`/learn/c/${concept.id}`}
            className={cn(
              'text-ink hover:text-accent',
              door ? 'text-body font-semibold' : 'text-body font-medium',
            )}
          >
            {concept.name}
          </Link>
          <span className="rounded-pill bg-sunken px-1.5 py-0.5 text-small text-ink-muted">
            {STATE_LABEL[concept.state]}
          </span>
          {next && (
            <span className="rounded-pill bg-accent-soft px-1.5 py-0.5 text-small text-accent">
              Start here
            </span>
          )}
        </p>

        {/* The claim, not a heading. This is the thing a question would be
            written against, and reading it is how you tell a real node from a
            chapter title that got in. */}
        <p className={cn('mt-0.5 text-ink', door ? 'text-body' : 'text-ui')}>{concept.claim}</p>

        {concept.misconception && (
          <p className="mt-1 text-ui text-danger">{concept.misconception}</p>
        )}

        <p className="mt-0.5 text-small text-ink-muted">
          {concept.state === 'unknown'
            ? concept.basis
            : `${STATE_LABEL[concept.state]} — ${ESTABLISHED_LABEL[concept.established]}. ${concept.basis}`}
        </p>

        <LastChecked concept={concept} timezone={timezone} />

        <div className="mt-2">
          <ReadAbout concept={concept} subjectId={subjectId} />
        </div>
      </div>
    </li>
  );
}

function ConceptCard({
  concepts,
  nextId,
  subjectId,
  timezone,
}: {
  concepts: Concept[];
  nextId: string | null;
  subjectId: string;
  timezone: string;
}) {
  return (
    <ul className={cn(cardVariants(), 'divide-y divide-border overflow-hidden')}>
      {concepts.map((concept) => (
        <ConceptRow
          key={concept.id}
          concept={concept}
          next={concept.id === nextId}
          subjectId={subjectId}
          timezone={timezone}
        />
      ))}
    </ul>
  );
}

/**
 * The doors first, then what follows from them.
 *
 * Two cards rather than one list, because a subject is a dozen ideas you have
 * to get through and everything downstream of them, and a single flat list
 * says the opposite. The learning order inside each group is untouched -- the
 * split is a filter over the order, not a reordering.
 *
 * A subject where nothing is marked, or where everything is, gets exactly the
 * one card it got before: two headings over a group and an empty one would be
 * saying something about the graph that the graph does not say.
 */
export function ConceptList({
  concepts,
  nextId,
  subjectId,
  timezone,
}: {
  concepts: Concept[];
  nextId: string | null;
  subjectId: string;
  /** The account's timezone, for the day each claim was last checked on. */
  timezone: string;
}) {
  const doors = concepts.filter((concept) => concept.kind === 'threshold');
  const rest = concepts.filter((concept) => concept.kind !== 'threshold');

  if (doors.length === 0 || rest.length === 0) {
    return (
      <ConceptCard
        concepts={concepts}
        nextId={nextId}
        subjectId={subjectId}
        timezone={timezone}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="mb-1 text-small font-semibold text-ink-muted">
          {doors.length === 1 ? 'The door' : 'The doors'}
        </h3>
        <ConceptCard concepts={doors} nextId={nextId} subjectId={subjectId} timezone={timezone} />
      </div>
      <div>
        <h3 className="mb-1 text-small font-semibold text-ink-muted">What follows from them</h3>
        <ConceptCard concepts={rest} nextId={nextId} subjectId={subjectId} timezone={timezone} />
      </div>
    </div>
  );
}
