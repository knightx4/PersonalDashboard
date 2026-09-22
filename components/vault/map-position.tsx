import type { PositionKind } from '@/lib/learn/graph/position-prompt';
import { POSITION_KIND_LABEL, STANCE_LABEL } from '@/lib/vault/map/labels';
import type { ProposedStance } from '@/lib/vault/map/proposal';
import { cn } from '@/lib/cn';

/**
 * One position as a reader checks it: what it says, what kind of thing it is,
 * whose it is, and the sentence in the note it came from.
 *
 * Shared by the review on a note's page, where each of these sits beside a
 * tick, and the map pages, which show the accepted rows the same way. The
 * quote is always shown: it is the one part of a position that was checked
 * against the note, and the only way to tell a fair reading from a stretch.
 */
export function MapPosition({
  name,
  statement,
  kind,
  stance,
  quote,
  under,
  basis,
  tag,
  className,
}: {
  name: string;
  statement: string;
  kind: PositionKind;
  stance: ProposedStance;
  quote: string;
  /** Theme names it sits under, when the context does not already say. */
  under?: string[];
  basis?: string | null;
  /** One short warning beside the name, e.g. that nothing is left to hold it. */
  tag?: string | null;
  className?: string;
}) {
  return (
    <span className={cn('block min-w-0', className)}>
      <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-body font-medium text-ink">{name}</span>
        <span className="text-small text-ink-muted">
          {POSITION_KIND_LABEL[kind]} · {STANCE_LABEL[stance]}
        </span>
        {tag && (
          <span className="rounded-pill bg-sunken px-1.5 py-0.5 text-small text-ink-muted">
            {tag}
          </span>
        )}
      </span>
      <span className="mt-0.5 block text-ui text-ink">{statement}</span>
      <MapQuote quote={quote} className="mt-1.5" />
      {(under?.length || basis) && (
        <span className="mt-1 block text-small text-ink-muted">
          {under && under.length > 0 && <>Under {under.join(', ')}. </>}
          {basis}
        </span>
      )}
    </span>
  );
}

/** The sentence from the note, set apart from the reading of it. */
export function MapQuote({ quote, className }: { quote: string; className?: string }) {
  return (
    <span
      className={cn(
        'block whitespace-pre-line border-l-2 border-border pl-3 text-ui text-ink-muted',
        className,
      )}
    >
      {quote}
    </span>
  );
}
