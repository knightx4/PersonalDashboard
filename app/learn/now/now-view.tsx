import type { ReactNode } from 'react';
import { ArrowRight, BookOpen } from 'lucide-react';
import Link, { linkVariants } from '@/components/ui/link';
import { buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { MainRail } from '@/components/patterns/main-rail';
import { PageColumn } from '@/components/shell/page-width';
import { Skeleton, PageHeaderSkeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/cn';
import { practiceHref } from '@/lib/learn/flow/href';
import type { WaitingLine } from '@/lib/learn/feed/waiting';

/**
 * Now as it opens (plan #2313.1): today's piece, the press to practise
 * across your prepared subjects, and beside them what is waiting and which
 * subjects are still being prepared. Nothing to swipe: the cards written
 * before this are a page of their own, linked from the waiting list until
 * the last is answered.
 *
 * Main plus rail (components/patterns/main-rail.tsx). The main column is
 * what you came to do; the rail is counts and runs to glance at. On a phone
 * the rail follows the main column.
 *
 * Drawn from props alone, so the gallery draws the same page from fixtures.
 */

/** A subject whose preparation has not finished, as the rail lists it. */
export type PreparingRow = { subjectId: string; name: string; line: string };

export function NowView({
  header,
  today,
  hasPiece,
  prepared,
  preparing,
  waiting,
  waitingEmpty,
  dashToday = null,
  children = null,
}: {
  header: ReactNode;
  /** Today's piece, as `PieceFirst` draws it, or nothing when there is none. */
  today: ReactNode;
  hasPiece: boolean;
  /** How many of your subjects are prepared. */
  prepared: number;
  preparing: readonly PreparingRow[];
  waiting: readonly WaitingLine[];
  waitingEmpty: 'nothing' | 'unread' | null;
  /** What Dash did today in Learn, streamed into the rail. */
  dashToday?: ReactNode;
  /** The research briefs, the readings you queued and the reviews due, under the practice press. */
  children?: ReactNode;
}) {
  const ready = hasPiece || prepared > 0;
  const main = (
    <>
      {header}
      {today}
      {ready ? (
        <PracticePress prepared={prepared} lead={!hasPiece} />
      ) : (
        <EmptyState
          icon={BookOpen}
          title="No subject is prepared yet"
          description={
            preparing.length > 0
              ? 'Dash is still preparing your subjects. When the first is ready its first piece opens here, with practice across everything you added.'
              : 'Add a subject and Dash prepares it: finds syllabi, lays out its topics and writes its first lessons. Its first piece then opens here, with practice across everything you added.'
          }
          action={{ label: 'Add a subject', href: '/learn/know' }}
          className="mb-6"
        />
      )}
      {children}
    </>
  );
  // With nothing waiting and nothing preparing the rail would hold at most
  // what Dash did today, which is absent on most days, so the page is one
  // column and that fold follows the main column instead of holding a
  // column open beside it.
  if (waiting.length === 0 && waitingEmpty !== 'unread' && preparing.length === 0) {
    return (
      <PageColumn>
        {main}
        <div className="mt-6">{dashToday}</div>
      </PageColumn>
    );
  }
  return (
    <MainRail
      main={main}
      rail={
        <>
          <WaitingList lines={waiting} empty={waitingEmpty} />
          <PreparingList rows={preparing} />
          {dashToday}
        </>
      }
    />
  );
}

/**
 * The press to practise. It leads when there is no piece today, and follows
 * the piece quietly when there is one, so the page has one primary press.
 */
function PracticePress({ prepared, lead }: { prepared: number; lead: boolean }) {
  return (
    <Card padding="standard" className="mb-6">
      {/* With no piece today the card says so, so a missing piece does not
          read as one that failed to load. */}
      {lead && <p className="mb-1 text-ui text-ink-muted">No piece is waiting today.</p>}
      <h2 className="text-body font-semibold text-ink">
        Practice
        {prepared > 0 && (
          <span className="font-normal text-ink-muted">
            {' '}
            · {prepared} {prepared === 1 ? 'subject' : 'subjects'}
          </span>
        )}
      </h2>
      <Link
        href={practiceHref()}
        className={cn(buttonVariants({ variant: lead ? 'primary' : 'secondary' }), 'mt-3')}
      >
        Start practising
        <ArrowRight className="size-4" strokeWidth={1.75} aria-hidden />
      </Link>
    </Card>
  );
}

/**
 * What is waiting for you, one linked count a line (lib/learn/feed/waiting.ts).
 * Nothing waiting draws nothing; a count that could not be read says so.
 */
function WaitingList({ lines, empty }: { lines: readonly WaitingLine[]; empty: 'nothing' | 'unread' | null }) {
  if (lines.length === 0 && empty !== 'unread') return null;
  return (
    <Card padding="standard" role="region" aria-labelledby="now-waiting">
      <h2 id="now-waiting" className="mb-1.5 text-ui font-semibold text-ink">
        Waiting for you
      </h2>
      {lines.length === 0 ? (
        <p className="text-ui text-ink-muted">What is waiting could not be read. Reload to try again.</p>
      ) : (
        <ul className="space-y-0.5">
          {lines.map((line) => (
            <li key={line.key}>
              <Link href={line.href} className={cn('press-area block text-ui', linkVariants())}>
                {line.text}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Subjects still being prepared, each with the step its run is on. Drawn only while a run is unfinished. */
function PreparingList({ rows }: { rows: readonly PreparingRow[] }) {
  if (rows.length === 0) return null;
  return (
    <Card padding="standard" role="region" aria-labelledby="now-preparing">
      <h2 id="now-preparing" className="mb-1.5 text-ui font-semibold text-ink">
        Preparing
      </h2>
      <ul className="space-y-2">
        {rows.map((row) => (
          <li key={row.subjectId}>
            <Link href={`/learn/s/${row.subjectId}`} className={cn('text-ui', linkVariants())}>
              {row.name}
            </Link>
            <p className="text-small text-ink-muted">{row.line}</p>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Now while it loads: the header, the piece, the practice press, and the rail beside them. */
export function NowSkeleton() {
  return (
    <MainRail
      main={
        <>
          <PageHeaderSkeleton />
          <Skeleton className="mb-1.5 h-3 w-40" />
          <Skeleton className="mb-6 h-72 rounded-card" />
          <Skeleton className="mb-6 h-32 rounded-card" />
        </>
      }
      rail={
        <>
          {[3, 2].map((rows, group) => (
            <div key={group} className="space-y-2 px-1">
              <Skeleton className="h-3.5 w-28" />
              {Array.from({ length: rows }).map((_, item) => (
                <Skeleton key={item} className="h-3.5" style={{ width: `${80 - item * 12}%` }} />
              ))}
            </div>
          ))}
        </>
      }
    />
  );
}
