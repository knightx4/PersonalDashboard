import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { cardVariants } from '@/components/ui/card';
import { MapQuote } from '@/components/vault/map-position';
import { cn } from '@/lib/cn';
import { quoteFragment } from '@/lib/vault/map/fragment';
import type { MergeLogItem, MergeLogPage, MergeLogRow, MergeLogSide } from '@/lib/vault/map/merge-log';
import { noteHref } from '@/lib/vault/paths';
import { SurvivorName, UndoMergeButton } from './merge-log-controls';

/**
 * Every merge the map has made, with an undo on each (plan #821).
 *
 * Proposals are merged without review (#814 answered C), so this list is
 * where a wrong one is found and put right. Theme merges come first because
 * they change which themes Learn offers. Each row shows the side that was
 * folded in, the side that was kept, a few of the notes or quotes each had,
 * and the model's reason for calling them one.
 */

const dateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long' });

export function MergeLog({ log }: { log: MergeLogPage }) {
  const { counts, rows, page, pages } = log;
  const total = counts.theme + counts.position;
  if (total === 0) return null;

  return (
    <section id="merges" aria-labelledby="merges-heading" className="mt-8 scroll-mt-4">
      <h2 id="merges-heading" className="text-body font-semibold text-ink">
        Merges
      </h2>
      <p className="mb-3 mt-1 text-ui text-ink-muted">
        {count(counts.theme, 'theme merge', 'theme merges')} and{' '}
        {count(counts.position, 'position merge', 'position merges')}, theme merges first, newest
        first within each
        {counts.undone > 0 && `. ${counts.undone} undone`}. Undoing one puts both sides back as
        they were, and the map will not merge that pair again.
      </p>

      <ul className={cn(cardVariants(), 'divide-y divide-border overflow-hidden')}>
        {rows.map((row) => (
          <li key={row.id} className="card-pad-dense">
            <MergeRow row={row} />
          </li>
        ))}
      </ul>

      {pages > 1 && <Pager page={page} pages={pages} />}
    </section>
  );
}

function MergeRow({ row }: { row: MergeLogRow }) {
  const survivorLive = row.survivorNameNow !== null;
  const noun = row.kind === 'theme' ? 'theme' : 'position';

  return (
    <article>
      <div className="flex items-start gap-3">
        <p className="min-w-0 flex-1 text-small text-ink-muted">
          {row.kind === 'theme' ? 'Themes' : 'Positions'} merged{' '}
          {dateFormat.format(new Date(row.mergedAt))}
          {row.undoneAt && <>, undone {dateFormat.format(new Date(row.undoneAt))}</>}
        </p>
        {!row.undoneAt && survivorLive && <UndoMergeButton mergeId={row.id} />}
      </div>

      <div className="mt-2 grid gap-3 sm:grid-cols-[1fr_auto_1fr]">
        <Side label="Folded in" side={row.absorbed} kind={row.kind} />
        <ArrowRight
          className="hidden size-4 self-start text-ink-muted sm:mt-5 sm:block"
          strokeWidth={2}
          aria-hidden
        />
        <Side
          label="Kept"
          side={row.survivor}
          kind={row.kind}
          name={
            row.kind === 'theme' && survivorLive ? (
              <SurvivorName themeId={row.survivorId} name={row.survivorNameNow ?? ''} />
            ) : null
          }
          renamed={
            row.kind === 'position' && survivorLive && row.survivorNameNow !== row.survivor.name
              ? row.survivorNameNow
              : null
          }
          was={
            row.kind === 'theme' && survivorLive && row.survivorNameNow !== row.survivor.name
              ? row.survivor.name
              : null
          }
        />
      </div>

      {row.reason && <p className="mt-3 text-ui text-ink">{row.reason}</p>}

      {!row.undoneAt && !survivorLive && (
        <p className="mt-2 text-small text-ink-muted">
          The {noun} it was kept as has since been merged into another. Undo that merge first, and
          this one can be undone after it.
        </p>
      )}
    </article>
  );
}

function Side({
  label,
  side,
  kind,
  name,
  renamed,
  was,
}: {
  label: string;
  side: MergeLogSide;
  kind: MergeLogRow['kind'];
  /** An editable name in place of the plain one. */
  name?: React.ReactNode;
  /** A position's name now, when the merge renamed it. */
  renamed?: string | null;
  /** A theme's name before the merge, when it is called something else now. */
  was?: string | null;
}) {
  const unit = kind === 'theme' ? ['note', 'notes'] : ['quote', 'quotes'];
  const more = side.count - side.items.length;

  return (
    <div className="min-w-0">
      <p className="text-small text-ink-muted">{label}</p>
      {name ?? <p className="text-ui font-medium text-ink">{side.name}</p>}
      {was && <p className="px-1 text-small text-ink-muted">Was {was}</p>}
      {renamed && <p className="text-small text-ink-muted">Now {renamed}</p>}
      {side.items.length > 0 ? (
        <ul className="mt-1 space-y-1">
          {side.items.map((item, i) => (
            <li key={i}>{kind === 'theme' ? <NoteLink item={item} /> : <Quote item={item} />}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-small text-ink-muted">No {unit[1]}</p>
      )}
      {more > 0 && (
        <p className="mt-1 text-small text-ink-muted">
          and {count(more, unit[0], unit[1])} more
        </p>
      )}
    </div>
  );
}

function NoteLink({ item }: { item: MergeLogItem }) {
  if (!item.path) {
    return <span className="text-small text-ink-muted">{item.title ?? 'A note'}, no longer in the vault</span>;
  }
  return (
    <Link href={noteHref(item.path)} className="block truncate text-small text-ink hover:underline">
      {item.title ?? item.path}
    </Link>
  );
}

function Quote({ item }: { item: MergeLogItem }) {
  return (
    <span className="block">
      {item.quote && <MapQuote quote={item.quote} className="line-clamp-3 text-small" />}
      <span className="mt-0.5 block pl-3.5 text-small text-ink-muted">
        {item.path ? (
          <>
            From{' '}
            {/* A plain anchor: a browser acts on a text fragment only on a
                document load, as on the theme page. */}
            <a
              href={`${noteHref(item.path)}${item.quote ? quoteFragment(item.quote) : ''}`}
              className="font-medium text-ink underline-offset-2 hover:underline"
            >
              {item.title ?? item.path}
            </a>
          </>
        ) : (
          'From a note no longer in the vault'
        )}
      </span>
    </span>
  );
}

function Pager({ page, pages }: { page: number; pages: number }) {
  const href = (n: number) => `/vault/map?merges=${n}#merges`;
  return (
    <nav aria-label="Pages of merges" className="mt-3 flex items-center justify-between text-ui">
      {page > 1 ? (
        <Link href={href(page - 1)} className="text-ink hover:underline">
          Previous
        </Link>
      ) : (
        <span />
      )}
      <span className="text-ink-muted tabular-nums">
        Page {page} of {pages}
      </span>
      {page < pages ? (
        <Link href={href(page + 1)} className="text-ink hover:underline">
          Next
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}

function count(n: number, one: string, many: string): string {
  return `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`;
}
