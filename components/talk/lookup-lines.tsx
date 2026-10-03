import { Check, CornerDownRight, X } from 'lucide-react';
import { Disclosure } from '@/components/ui/disclosure';
import { lookupOutcome, turnLookups, type LookupLine } from '@/lib/talk/lookups';
import type { TalkToolCall } from '@/lib/talk/talk';

/**
 * What Dash looked up for an answer, one line each (plan #1438): listed live
 * under the working line while the answer is written, and folded beneath the
 * answer once it lands. The words come from lib/talk/lookups.ts, so both read
 * the same.
 */

function LineMark({ state }: { state: LookupLine['state'] }) {
  const Glyph = state === 'done' ? Check : state === 'failed' ? X : CornerDownRight;
  return (
    <Glyph
      aria-hidden
      strokeWidth={2}
      className={state === 'failed' ? 'size-3 shrink-0 translate-y-0.5 text-danger' : 'size-3 shrink-0 translate-y-0.5 text-ink-ghost'}
    />
  );
}

export function LookupList({ lines, label }: { lines: readonly LookupLine[]; label: string }) {
  if (lines.length === 0) return null;
  return (
    <ul className="space-y-0.5" aria-label={label}>
      {lines.map((line) => {
        const outcome = lookupOutcome(line);
        return (
          <li key={line.id} className="flex min-w-0 items-baseline gap-1.5 text-ui text-ink-muted">
            <LineMark state={line.state} />
            <span className="min-w-0 truncate">
              {line.label}
              {line.state === 'running' ? '…' : null}
            </span>
            {outcome ? <span className="shrink-0 text-small text-ink-ghost">{outcome}</span> : null}
          </li>
        );
      })}
    </ul>
  );
}

/** A finished answer's lookups, folded; nothing for an answer that made none. */
export function LookupFold({ calls }: { calls: readonly TalkToolCall[] | undefined }) {
  const lines = turnLookups(calls);
  if (lines.length === 0) return null;
  return (
    <Disclosure
      title="What Dash looked up"
      meta={lines.length === 1 ? '1 lookup' : `${lines.length} lookups`}
      className="pt-1"
    >
      <LookupList lines={lines} label="What Dash looked up" />
    </Disclosure>
  );
}
