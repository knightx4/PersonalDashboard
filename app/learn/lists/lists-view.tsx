import Link from 'next/link';
import { BookOpen, CornerDownRight, Plus } from 'lucide-react';
import { ListPage } from '@/components/patterns/list-detail';
import { PageHeader } from '@/components/shell/page-header';
import { SearchEmpty } from '@/components/shell/search-empty';
import { SearchField } from '@/components/shell/search-field';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import type { TrackProgress } from '@/lib/learn/tracks/load';
import type { NestedTrack } from '@/lib/learn/tracks/tree';

/**
 * The reading lists, which the database and the code still call tracks. They
 * were Learn's front page until Practice Flow took /learn (plan #773), and
 * "track" on screen now means a subject, the thing the flow asks about.
 *
 * Newest first, because a reading queue is a stack of current interests rather
 * than a library: the thing you started on Tuesday is the thing you are most
 * likely to want on Wednesday.
 *
 * A track kept out of a broad topic, or branched off one step of a route, is
 * drawn under the one it came from and inset. Ten rows that are really three
 * subjects and seven parts of them read as ten unrelated topics otherwise.
 *
 * The search box narrows the list by title and question, and by the readings
 * inside each track: the title of a book you queued brings back the track
 * holding it, with that reading listed under the row. The query lives in the
 * URL, so a narrowed list survives a refresh and can be sent as a link. A
 * branch whose parent the search did not match is still shown, at the top
 * level, because a hit you cannot see is worse than a lost indent.
 */

function ProgressBar({ progress }: { progress: TrackProgress }) {
  const percent = Math.round(progress.fraction * 100);

  return (
    // Count over the bar at phone width, so the title keeps the row; side by
    // side from sm, where there is room for both.
    <div className="flex shrink-0 flex-col-reverse items-end gap-1 sm:flex-row sm:items-center sm:gap-2">
      <div
        className="h-1.5 w-14 overflow-hidden rounded-pill bg-sunken sm:w-28"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Progress through this reading list"
      >
        <div className="h-full rounded-pill bg-accent" style={{ width: `${percent}%` }} />
      </div>
      <span className="text-right sm:min-w-[4ch] text-small tabular-nums text-ink-muted">
        {progress.read}/{progress.read + progress.remaining}
      </span>
    </div>
  );
}

/**
 * The reading lists as nested rows, and what was searched for (plan #1602).
 * The list-and-detail pattern (plan #1762): the header with its one action,
 * the search, one surface of rows with each list's progress at the right edge,
 * then the count. What the page is for is said by the empty state, not under
 * the heading.
 */
export function ListsView({ rows, search }: { rows: NestedTrack[]; search: string }) {
  const header = (
    <PageHeader
      title="Reading lists"
      actions={
        <Link href="/learn/new" className={buttonVariants({ variant: 'primary', size: 'sm' })}>
          <Plus className="size-4" strokeWidth={2} aria-hidden />
          New reading list
        </Link>
      }
    />
  );
  const tools = (
    <div className="max-w-md">
      <SearchField placeholder="Search your reading lists" />
    </div>
  );

  if (rows.length === 0) {
    return (
      <div className="mx-auto max-w-3xl">
        {header}
        <div className="mb-4">{tools}</div>
        {search ? (
          // Only when something was searched for. Without that check an empty
          // queue would say nothing matched, when the queue is what is empty.
          <SearchEmpty query={search} />
        ) : (
          <EmptyState
            icon={BookOpen}
            title="Nothing queued"
            description="Things worth reading, resolved to real links and pointed at the part that matters. Paste what someone told you to read, such as a reply from a chat, a syllabus or a footnote, and each item gets somewhere you can open, with a note on which part to read."
            action={{ label: 'Paste a reading list', href: '/learn/new' }}
          />
        )}
      </div>
    );
  }

  return (
    <ListPage
      header={header}
      tools={tools}
      foot={`${rows.length} reading ${rows.length === 1 ? 'list' : 'lists'}`}
    >
      {rows.map(({ track, depth, rolled }) => {
        // The inset a branch is drawn at. Named because anything else the
        // row grows -- a list of matching readings under it -- has to line
        // up with the title rather than with the card's edge.
        const inset = `${1 + depth * 1.25}rem`;

        return (
          <li key={track.id}>
            <Link
              href={`/learn/t/${track.id}`}
              className="flex min-h-11 items-center gap-x-4 py-3.5 pr-4 transition-colors duration-quick hover:bg-sunken"
              style={{ paddingLeft: inset }}
            >
              <span className="min-w-0 flex-1">
                <span className="block text-body font-medium text-ink">
                  {depth > 0 && (
                    <CornerDownRight
                      className="mr-1.5 inline size-3.5 shrink-0 align-[-0.15em] text-ink-muted"
                      strokeWidth={2}
                      aria-hidden
                    />
                  )}
                  {track.title}
                </span>
                {track.question && (
                  // The question, not a summary of the track. It is what you
                  // were actually stuck on, and it is what makes this row
                  // recognisable six weeks later.
                  <span className="mt-0.5 block text-ui text-ink-muted">{track.question}</span>
                )}
              </span>
              <ProgressBar progress={rolled} />
            </Link>
            {track.matches.length > 0 && (
              // Outside the link above, because a link inside a link is
              // invalid and each of these goes somewhere of its own. One
              // step further in than the title, so they read as being
              // inside the track rather than as more tracks.
              <ul className="pb-3" style={{ paddingLeft: inset }}>
                {track.matches.map((reading) => (
                  <li key={reading.id}>
                    <Link
                      href={`/learn/r/${reading.id}`}
                      className="flex items-center gap-1.5 py-1 pl-5 pr-4 text-ui text-ink-muted transition-colors duration-quick hover:text-ink"
                    >
                      <CornerDownRight className="size-3.5 shrink-0" strokeWidth={2} aria-hidden />
                      <span className="truncate">{reading.subject}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ListPage>
  );
}
