import { cn } from '@/lib/cn';
import type { ConceptKind } from '@/lib/learn/graph/model';

/**
 * Whether a concept is a door into its subject, said in one word.
 *
 * The door is the thing worth seeing, so it carries the accent and everything
 * downstream of it is a quiet pill. A concept nobody has marked -- everything
 * in a graph from before the distinction existed, and any node the model said
 * nothing usable about -- renders nothing at all: an unjudged claim looks
 * exactly like what it is, rather than being called a consequence by default.
 *
 * A span rather than a `div`, because half the call sites put it inside
 * phrasing content already.
 */

export const KIND_LABEL: Record<ConceptKind, string> = {
  threshold: 'Door',
  consequence: 'Follows on',
};

/**
 * The same distinction in a sentence, for a page with room for one. The door's
 * line says what being a door costs you rather than restating the word.
 */
export const KIND_LINE: Record<ConceptKind, string> = {
  threshold: 'A door into this subject. What sits after it does not land until you are through it.',
  consequence: 'Follows on from the doors in this subject, and is learnable once you hold them.',
};

export function KindBadge({ kind, className }: { kind: ConceptKind | null; className?: string }) {
  if (!kind) return null;

  return (
    <span
      className={cn(
        'rounded-pill px-1.5 py-0.5 text-small',
        kind === 'threshold' ? 'bg-accent-soft text-accent' : 'bg-sunken text-ink-muted',
        className,
      )}
    >
      {KIND_LABEL[kind]}
    </span>
  );
}
