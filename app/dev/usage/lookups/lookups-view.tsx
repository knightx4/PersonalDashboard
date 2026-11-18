import Link from '@/components/ui/link';
import { PageHeader } from '@/components/shell/page-header';
import { PageColumn } from '@/components/shell/page-width';
import { cardVariants } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { Disclosure } from '@/components/ui/disclosure';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/cn';
import { sectionSubject } from '@/lib/core/section-path';
import { whenAt } from '@/lib/core/when';
import { MAX_LOOKUPS } from '@/lib/dash/loop';
import { inputText, type LookupCapEntry } from '@/lib/dash/lookup-caps';
import { formatMicroDollars } from '@/lib/money';

/**
 * Ran out of lookups, under Usage in Dev (plan #3092): every Ask Dash answer
 * that stopped because it used all its lookups, newest first, from
 * core.dash_lookup_caps. Each row is the question, when and where it was
 * asked, how long it took and what it cost, and folds open to the lookups in
 * the order Dash made them, so the owner can judge whether a lookup was
 * wasted, several could have been one, or the question belonged to a session.
 *
 * Apart from the route so the gallery can draw it from a fixture.
 */

export const LOOKUPS_HREF = '/dev/usage/lookups';

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** Where the question was asked, as the row's meta line names it. */
export function askedFrom(entry: Pick<LookupCapEntry, 'surface' | 'pagePath' | 'scope'>): string {
  if (entry.surface === 'eval') return 'Dash quality check';
  if (entry.pagePath) return `Asked on ${entry.pagePath}`;
  return entry.scope ? `Asked in Ask Dash, kept to ${entry.scope}` : 'Asked in Ask Dash';
}

function costText(micros: number | null): string {
  return micros === null ? 'not priced' : formatMicroDollars(micros, { fromCent: true });
}

function LookupList({ entry, open }: { entry: LookupCapEntry; open: boolean }) {
  const failed = entry.lookups.filter((lookup) => !lookup.ok).length;
  const unkept = entry.lookupCount - entry.lookups.length;
  return (
    <Disclosure
      title="Lookups in order"
      meta={`${entry.lookupCount}${failed > 0 ? `, ${failed} failed` : ''}`}
      defaultOpen={open}
      className="mt-1.5"
    >
      <ol className="space-y-1.5">
        {entry.lookups.map((lookup, index) => (
          <li key={index} className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-1 text-small">
            <span className="text-right text-ink-muted tabular-nums">{index + 1}.</span>
            <span className="min-w-0">
              <span className="font-mono text-ink">{lookup.tool}</span>
              {!lookup.ok && <span className="ml-2 font-medium text-danger">failed</span>}
              <span className="block font-mono text-ink-muted [overflow-wrap:anywhere]">{inputText(lookup.input)}</span>
            </span>
          </li>
        ))}
      </ol>
      {unkept > 0 && <p className="mt-1.5 text-small text-ink-muted">{plural(unkept, 'more lookup', 'more lookups')} not kept.</p>}
    </Disclosure>
  );
}

function CapRow({ entry, timeZone, now, open }: { entry: LookupCapEntry; timeZone: string; now: Date; open: boolean }) {
  const meta = [
    whenAt(entry.at, { timeZone, now }),
    askedFrom(entry),
    `${entry.seconds.toFixed(entry.seconds < 10 ? 1 : 0)} s`,
    costText(entry.costMicros),
  ].join(' · ');
  const run = entry.surface === 'eval' ? entry.evalRunId : entry.turnId;
  return (
    <li className="px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 text-ui text-ink line-clamp-3 [overflow-wrap:anywhere]">{entry.question}</p>
        {entry.cutShort && (
          <Chip tone="caution" size="sm" className="mt-0.5">
            Cut short
          </Chip>
        )}
      </div>
      <p className="mt-0.5 text-small text-ink-muted tabular-nums">{meta}</p>
      <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-small text-ink-muted">
        {entry.conversationId && (
          <Link
            href={`/chat/dash/${entry.conversationId}`}
            // A 44px press area that reaches into the space around the line rather than adding to it.
            className="-my-3 inline-flex min-h-11 items-center font-medium text-accent hover:underline"
          >
            Open the chat
          </Link>
        )}
        {run && (
          <span className="font-mono">
            {entry.surface === 'eval' ? 'Run' : 'Answer'} {run.slice(0, 8)}
          </span>
        )}
        <span>{entry.model}</span>
      </p>
      <LookupList entry={entry} open={open} />
    </li>
  );
}

export function LookupCapsScreen({
  entries,
  timeZone,
  now,
  openFirst = false,
}: {
  /** Newest first; null when they could not be read. */
  entries: readonly LookupCapEntry[] | null;
  timeZone: string;
  now: Date;
  /** The newest row's lookups drawn open, for the gallery. */
  openFirst?: boolean;
}) {
  const cut = entries?.filter((entry) => entry.cutShort).length ?? 0;
  return (
    <PageColumn>
      <PageHeader
        subject={sectionSubject('/dev/usage', 'Usage', { label: 'Ran out of lookups', href: LOOKUPS_HREF })}
        title="Ran out of lookups"
        description={`Ask Dash answers that used all ${MAX_LOOKUPS} lookups, newest first.`}
      />
      {entries === null ? (
        <EmptyState
          size="box"
          title="The list could not be read."
          description="Reload the page to try again."
        />
      ) : entries.length === 0 ? (
        <EmptyState
          size="box"
          title="No answer has run out of lookups yet."
          description={`An Ask Dash answer that uses all ${MAX_LOOKUPS} lookups is listed here, with each lookup it made.`}
        />
      ) : (
        <>
          <ul className={cn(cardVariants(), 'divide-y divide-border overflow-hidden')}>
            {entries.map((entry, index) => (
              <CapRow key={entry.id} entry={entry} timeZone={timeZone} now={now} open={openFirst && index === 0} />
            ))}
          </ul>
          <p className="mt-2 text-small text-ink-muted tabular-nums">
            {plural(entries.length, 'answer', 'answers')}
            {cut > 0 && `, ${cut} cut short`}
          </p>
        </>
      )}
    </PageColumn>
  );
}
