import { ChevronDown, Lightbulb } from 'lucide-react';
import Link from '@/components/ui/link';
import { ActionMenu } from '@/components/ui/action-menu';
import { Banner } from '@/components/ui/banner';
import { cardVariants } from '@/components/ui/card';
import { toggleChipClass } from '@/components/ui/chip';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { segmentedTrack, trackSegmentClass } from '@/components/ui/segmented';
import {
  IDEA_SORTS,
  IDEA_SORT_LABEL,
  ideasHref,
  type IdeaCounts,
  type IdeaListPage,
  type IdeaRow,
  type IdeaSort,
  type MapView,
} from '@/lib/vault/map/ideas';
import { quoteFragment } from '@/lib/vault/map/fragment';
import { noteHref } from '@/lib/vault/paths';
import { formatNumber } from '@/lib/money';
import { cn } from '@/lib/cn';

/**
 * The Map's Ideas view (plan #2947.5): your own ideas and designs ranked by
 * the scores Jev gave them, each opening the note at the sentence it came
 * from. Drawn from what the page read, so the gallery draws every state from
 * fixtures: the list, the sort menu open, nothing scored yet, loading, and a
 * failed read.
 */

export type IdeasState =
  | { status: 'ready'; list: IdeaListPage; jevOn: boolean }
  | { status: 'error'; sort: IdeaSort; message: string };

/** Themes or Ideas, as two links: each view is an address. */
export function MapViewSwitch({ view }: { view: MapView }) {
  return (
    <nav aria-label="Map view" className={segmentedTrack}>
      <Link
        href="/vault/map"
        aria-current={view === 'themes' ? 'page' : undefined}
        className={trackSegmentClass(view === 'themes')}
      >
        Themes
      </Link>
      <Link
        href={ideasHref('combined')}
        aria-current={view === 'ideas' ? 'page' : undefined}
        className={trackSegmentClass(view === 'ideas')}
      >
        Ideas
      </Link>
    </nav>
  );
}

/** What the list is sorted by, as a word that opens the other two choices. */
export function IdeaSortMenu({ sort, open = false }: { sort: IdeaSort; open?: boolean }) {
  return (
    <ActionMenu
      label="Sort ideas by"
      align="end"
      defaultOpen={open}
      trigger={
        <span className="inline-flex items-center gap-1 whitespace-nowrap">
          Sort: {IDEA_SORT_LABEL[sort]}
          <ChevronDown strokeWidth={1.75} aria-hidden />
        </span>
      }
      triggerClassName={cn(toggleChipClass(false), 'w-auto')}
      // Each choice is a full 44px row on a phone, as the Map's other links are.
      panelClassName="max-sm:[&_a]:min-h-11"
      // The trigger names the sort in use, so the menu holds the other two:
      // the shared menu marks a current item in the default accent, which is
      // not the vault's (critic round 1).
      items={IDEA_SORTS.filter((candidate) => candidate !== sort).map((candidate) => ({
        id: `sort-${candidate}`,
        label: `Sort by ${IDEA_SORT_LABEL[candidate]}`,
        href: ideasHref(candidate),
      }))}
    />
  );
}

/** The switch and the sort on one line, above the rows. */
export function IdeasTools({
  sort,
  menuOpen = false,
}: {
  /** Null where there is nothing to sort. */
  sort: IdeaSort | null;
  menuOpen?: boolean;
}) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <MapViewSwitch view="ideas" />
      {sort && <IdeaSortMenu sort={sort} open={menuOpen} />}
    </div>
  );
}

/** The list, or what stands in its place. */
export function IdeasList({ state, menuOpen = false }: { state: IdeasState; menuOpen?: boolean }) {
  if (state.status === 'error') {
    return (
      <>
        <IdeasTools sort={null} />
        <Banner tone="bad">
          The scores could not be read, so no ideas are listed. Reload the page to try again.
          <span className="mt-1 block text-small text-ink-muted">{state.message}</span>
        </Banner>
      </>
    );
  }

  const { list, jevOn } = state;
  if (list.rows.length === 0) {
    return (
      <>
        <IdeasTools sort={null} />
        <EmptyState
          icon={Lightbulb}
          title="No ideas scored yet"
          description={
            jevOn
              ? `Jev scores your ideas for usefulness and novelty in the background, a few dozen every ten minutes, and they are listed here as it goes.${
                  list.counts.unscored > 0
                    ? ` ${countOf(list.counts.unscored, 'idea is', 'ideas are')} waiting.`
                    : ''
                }`
              : 'Your ideas are scored by Jev in the background, and Jev is turned off for this account, so nothing here is scored. Scoring starts once Jev is turned on.'
          }
          action={{ label: 'See the themes', href: '/vault/map' }}
        />
        {leftOutLine(list.counts) && (
          <p className="mt-3 text-small text-ink-muted">{leftOutLine(list.counts)}</p>
        )}
      </>
    );
  }

  const leftOut = leftOutLine(list.counts);
  return (
    <>
      <IdeasTools sort={list.sort} menuOpen={menuOpen} />
      <ul className={cn(cardVariants(), 'divide-y divide-border overflow-hidden')}>
        {/* The three columns named once, from sm; a phone row says them inline. */}
        <li aria-hidden className="card-pad-x hidden py-2 sm:flex sm:items-center sm:gap-6">
          <span className="flex-1" />
          <span className="grid w-48 shrink-0 grid-cols-3 gap-x-3 text-right text-small text-ink-muted">
            {SCORE_ORDER.map((key) => (
              <span key={key}>{IDEA_SORT_LABEL[key]}</span>
            ))}
          </span>
        </li>
        {list.rows.map((idea) => (
          <IdeaListRow key={idea.id} idea={idea} sort={list.sort} />
        ))}
        {leftOut && <li className="card-pad-x bg-sunken py-2.5 text-small text-ink-muted">{leftOut}</li>}
      </ul>
      <Foot list={list} />
    </>
  );
}

const SCORE_ORDER: IdeaSort[] = ['usefulness', 'novelty', 'combined'];

/** One idea. The row opens its note at the sentence, as a theme page's quote does. */
function IdeaListRow({ idea, sort }: { idea: IdeaRow; sort: IdeaSort }) {
  const body = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block text-body text-ink [overflow-wrap:anywhere]">{idea.statement}</span>
        <span className="mt-0.5 block truncate text-small text-ink-muted">
          {[idea.theme?.name, idea.source ? idea.source.title : 'No sentence left in the notes']
            .filter(Boolean)
            .join(' · ')}
        </span>
        <PhoneScores idea={idea} sort={sort} />
      </span>
      <ColumnScores idea={idea} sort={sort} />
    </>
  );
  const rowClass = 'card-pad-x flex items-center gap-6 py-3';

  return (
    <li>
      {idea.source ? (
        // A plain anchor: a browser acts on a text fragment only on a document
        // load, and Link's client-side move would open the note at the top.
        <a
          href={`${noteHref(idea.source.path)}${quoteFragment(idea.source.quote)}`}
          className={cn(rowClass, 'transition-colors duration-quick hover:bg-sunken')}
        >
          {body}
        </a>
      ) : (
        <div className={rowClass}>{body}</div>
      )}
    </li>
  );
}

function scoreOf(idea: IdeaRow, key: IdeaSort): number {
  return key === 'usefulness' ? idea.usefulness : key === 'novelty' ? idea.novelty : idea.combined;
}

/** Below sm: the three scores on one line, each named; the one sorted on in ink. */
function PhoneScores({ idea, sort }: { idea: IdeaRow; sort: IdeaSort }) {
  return (
    <span className="mt-1 block text-small text-ink-muted sm:hidden">
      {SCORE_ORDER.map((key, i) => (
        <span key={key}>
          {i > 0 && ' · '}
          {IDEA_SORT_LABEL[key]}{' '}
          <span className={cn('tabular', key === sort && 'font-medium text-ink')}>{scoreOf(idea, key)}</span>
        </span>
      ))}
    </span>
  );
}

/** From sm: the figures alone, under the column names at the top of the list. */
function ColumnScores({ idea, sort }: { idea: IdeaRow; sort: IdeaSort }) {
  return (
    <span className="hidden w-48 shrink-0 grid-cols-3 gap-x-3 text-right sm:grid">
      {SCORE_ORDER.map((key) => (
        <span
          key={key}
          className={cn('tabular text-ui', key === sort ? 'font-medium text-ink' : 'text-ink-muted')}
        >
          <span className="sr-only">{IDEA_SORT_LABEL[key]} </span>
          {scoreOf(idea, key)}
        </span>
      ))}
    </span>
  );
}

/** What the list leaves out as not your own ideas, or null when nothing is. */
function leftOutLine(counts: IdeaCounts): string | null {
  const parts = [
    counts.requirements > 0 && countOf(counts.requirements, 'requirement', 'requirements'),
    counts.othersIdeas > 0 && countOf(counts.othersIdeas, 'other person’s idea', 'other people’s ideas'),
    counts.descriptions > 0 && countOf(counts.descriptions, 'description', 'descriptions'),
  ].filter((p): p is string => Boolean(p));
  return parts.length > 0 ? `Not listed, as not your own ideas: ${parts.join(', ')}.` : null;
}

/** The count on the left edge, the page links on the right. */
function Foot({ list }: { list: IdeaListPage }) {
  const { counts, page, pages, sort } = list;
  const waiting = counts.unscored > 0 ? `, ${formatNumber(counts.unscored)} not yet` : '';
  return (
    <nav
      aria-label="Pages of ideas"
      className="mt-3 flex items-baseline justify-between gap-3 text-small text-ink-muted"
    >
      <span className="tabular">
        {pages > 1 && `Page ${page} of ${pages} · `}
        {formatNumber(counts.listed)} scored{waiting}
      </span>
      {pages > 1 && (
        <span className="flex shrink-0 gap-4 text-ui">
          {page > 1 && (
            <Link href={ideasHref(sort, page - 1)} className="press-area text-ink hover:underline">
              Previous
            </Link>
          )}
          {page < pages && (
            <Link href={ideasHref(sort, page + 1)} className="press-area text-ink hover:underline">
              Next
            </Link>
          )}
        </span>
      )}
    </nav>
  );
}

/** The rows while the scores are read. */
export function IdeasLoading({ sort }: { sort: IdeaSort }) {
  return (
    <>
      <IdeasTools sort={sort} />
      <div
        role="status"
        aria-label="Reading the scores"
        className={cn(cardVariants(), 'divide-y divide-border overflow-hidden')}
      >
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="card-pad-x flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:gap-6">
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-3.5" style={{ width: `${78 - index * 6}%` }} />
              <Skeleton className="h-3 w-1/3" />
            </div>
            <div className="w-48 shrink-0 space-y-1.5">
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3.5 w-full" />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function countOf(n: number, one: string, many: string): string {
  return `${formatNumber(n)} ${n === 1 ? one : many}`;
}
