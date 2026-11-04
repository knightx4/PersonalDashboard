import type { ComponentProps } from 'react';
import Link, { linkVariants } from '@/components/ui/link';
import { Card } from '@/components/ui/card';
import { DashMark } from '@/components/ui/dash-mark';
import { LiveDot } from '@/components/ui/live-dot';
import { SectionHeading, SectionLabel } from '@/components/ui/section-heading';
import { FileLinks } from '@/components/files/file-links';
import { cn } from '@/lib/cn';
import type { DashWorkItem } from '@/lib/goals/dash-work';
import { StripDone } from './strip-done';
import type { GoalStrip, StripCard } from '@/lib/goals/goal-strip';

/**
 * A goal's Dashboard tab (plan #2778.4), as the approved mockups have it
 * (docs/references/goal-dashboard): the Now / Next / Later strip straight
 * under the tabs, then the goal's done-when and where it stands, then the
 * goal's own tiles with Dash's card and the newest files beside them from
 * wide laptop width. On anything narrower Dash's card and the files come
 * after the lead tiles (the figures and the first wide part), so they are
 * reached early, and the rest of the tiles follow. What else feeds the goal
 * (what Dash found, suggestions, links) runs on underneath at full width.
 *
 * A layout and no data of its own: the page and the gallery pass each part.
 */
export function GoalDashboard({
  strip,
  top,
  lead,
  side,
  main,
  rest,
}: {
  strip: React.ReactNode;
  /** The done-when card and the status, under the strip. */
  top?: React.ReactNode;
  /** The lead tiles, or the line offering Dash lay them out. */
  lead?: React.ReactNode;
  /** Dash's card and Recent files. */
  side: React.ReactNode;
  /** The rest of the tiles and what stands with them. */
  main?: React.ReactNode;
  /** Everything else, at full width under the two columns. */
  rest?: React.ReactNode;
}) {
  return (
    <div className="space-y-6">
      {strip}
      {top}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_18rem] xl:grid-rows-[auto_1fr]">
        {lead && <div className="min-w-0 space-y-6 xl:col-start-1 xl:row-start-1">{lead}</div>}
        <div className="min-w-0 space-y-4 xl:sticky xl:top-20 xl:col-start-2 xl:row-span-2 xl:row-start-1 xl:self-start">
          {side}
        </div>
        {main && (
          <div
            className={cn(
              'min-w-0 space-y-6 xl:col-start-1',
              lead ? 'xl:row-start-2' : 'xl:row-span-2 xl:row-start-1',
            )}
          >
            {main}
          </div>
        )}
      </div>
      {rest}
    </div>
  );
}

/** The three cards at the top of the Dashboard: what is on you now, next, and later. */
export function GoalStripRow({ strip }: { strip: GoalStrip }) {
  // Nothing open at all: one line rather than three cards that each say so.
  if (!strip.now && !strip.next && !strip.later) {
    return (
      <Card padding="dense" role="region" aria-label="Now, next and later">
        <p className="text-small text-ink-muted">Nothing is open on this goal yet.</p>
      </Card>
    );
  }
  return (
    <section aria-label="Now, next and later" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <StripCell label="Now" card={strip.now} now empty="Nothing is on you on this goal." />
      <StripCell label="Next" card={strip.next} empty="Nothing else is open." />
      <StripCell
        label="Later"
        card={strip.later}
        more={strip.laterMore}
        empty="Nothing waits beyond that."
      />
    </section>
  );
}

function StripCell({
  label,
  card,
  now = false,
  more = 0,
  empty,
}: {
  label: string;
  card: StripCard | null;
  now?: boolean;
  more?: number;
  empty: string;
}) {
  const line = [card?.line, more > 0 ? `+${more} more` : null].filter(Boolean).join(' · ');
  return (
    <Card
      padding="dense"
      className={cn('flex min-w-0 flex-col gap-1', now && card && 'bg-accent-tint')}
    >
      <SectionLabel as="h2" className={cn(now && card && 'text-accent')}>
        {label}
      </SectionLabel>
      {card ? (
        <>
          <a
            href={card.href}
            className="press-area text-ui font-medium text-ink [overflow-wrap:anywhere] hover:text-accent"
          >
            {card.title}
          </a>
          <p className="mt-auto flex items-baseline justify-between gap-3 pt-1 text-small text-ink-muted">
            <span className="tabular min-w-0">{line}</span>
            {/* Now ends with Done when it is a step you can tick; Next and Later say where the rest of the plan is. */}
            {now ? (
              card.canClose && <StripDone stepId={card.id} />
            ) : (
              <a href={card.href} className={cn('press-area shrink-0', linkVariants())}>
                See the plan
              </a>
            )}
          </p>
        </>
      ) : (
        <p className="text-small text-ink-muted">{empty}</p>
      )}
    </Card>
  );
}

/**
 * What Dash is on under the goal (plan #2778.4), as the approved mockup has
 * it: each run going in a quiet box of its own, the question first and where
 * it has got to under it; then one line for what Dash last finished (a run in
 * the last day, or else its newest file); what it is waiting for you to
 * approve; and Ask Dash.
 */
export function DashOnCard({
  items,
  latest,
  shaping,
  ask,
}: {
  /** What Dash is on and finished in the last day, running first (dashWork). */
  items: readonly DashWorkItem[];
  /** The newest file Dash wrote, said when no run finished in the last day. */
  latest?: { title: string; href: string } | null;
  /** Dash's panel, while it has something to approve, is running, or has no plan to work. */
  shaping?: React.ReactNode;
  /** Ask Dash on this goal. */
  ask?: React.ReactNode;
}) {
  const running = items.filter((item) => item.state === 'running');
  const finished = items.find((item) => item.state === 'finished') ?? null;
  return (
    <Card padding="standard" role="region" aria-labelledby="dash-on-heading" className="space-y-3">
      <SectionHeading
        id="dash-on-heading"
        title={
          <span className="inline-flex items-center gap-1.5">
            <DashMark size="2xs" tone="brand" decorative />
            Dash is on
          </span>
        }
        count={
          running.length > 0
            ? running.length === 1
              ? '1 thing'
              : `${running.length} things`
            : undefined
        }
      />
      {running.length > 0 ? (
        <ul className="space-y-2">
          {running.map((item) => (
            <li key={item.runId} className="space-y-1 rounded-card bg-sunken/60 px-3 py-2.5">
              <a
                href={`/goals/runs/${item.runId}`}
                className="press-area block text-ui font-medium text-ink [overflow-wrap:anywhere] hover:text-accent"
              >
                {item.title}
              </a>
              <p className="flex items-baseline gap-1.5 text-small text-ink-muted">
                <LiveDot className="translate-y-[-1px]" />
                <span className="min-w-0">{item.line ?? 'Working on it'}</span>
              </p>
            </li>
          ))}
        </ul>
      ) : (
        // With something to approve or map, that is what the card says instead.
        !shaping && <p className="text-small text-ink-muted">Nothing running on this goal.</p>
      )}
      {(finished || latest) && (
        <p className="text-small text-ink-muted">
          Last finished:{' '}
          {finished ? (
            <a
              href={`/goals/runs/${finished.runId}`}
              className="press-area font-medium text-ink hover:text-accent"
            >
              {finished.title}
            </a>
          ) : (
            latest && (
              <Link
                href={latest.href}
                className="press-area font-medium text-ink hover:text-accent"
              >
                {latest.title}
              </Link>
            )
          )}
          {' · '}
          <Link href="?tab=files" className={cn('press-area', linkVariants({ tone: 'quiet' }))}>
            All of Dash’s work
          </Link>
        </p>
      )}
      {shaping}
      {ask}
    </Card>
  );
}

/** The goal's three newest files, with the way to all of them on Work & files. */
export function RecentFiles({
  files,
  unread,
}: {
  files: ComponentProps<typeof FileLinks>['files'];
  unread: string | null;
}) {
  return (
    <Card padding="none" role="region" aria-labelledby="recent-files-heading">
      <SectionHeading
        id="recent-files-heading"
        title="Recent files"
        count={unread ?? undefined}
        className="card-pad-x pt-3"
        action={
          <Link href="?tab=files" className={cn('press-area text-small', linkVariants())}>
            All files
          </Link>
        }
      />
      {files.length > 0 ? (
        <FileLinks files={files} bare />
      ) : (
        <p className="card-pad-x pt-1 pb-3 text-small text-ink-muted">
          Nothing filed yet. What Dash writes for this goal lands here.
        </p>
      )}
    </Card>
  );
}

/**
 * The Work & files tab (plan #2778.4): what Dash is on under the goal and
 * every file on it, the goal's own first. Plan #2778.7 gives it its views
 * (All, Dash wrote, Yours, Waiting for), uploads and Dash's full list of work.
 */
export function GoalWorkFiles({ work, files }: { work: React.ReactNode; files: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <section aria-labelledby="work-heading" className="space-y-2">
        <SectionHeading id="work-heading" title="Dash’s work" className="px-1" />
        <Card padding="dense">
          {work ?? (
            <p className="text-small text-ink-muted">
              Nothing running on this goal, and nothing finished in the last day.
            </p>
          )}
        </Card>
      </section>
      {files ?? (
        <section aria-labelledby="files-heading" className="space-y-2">
          <SectionHeading id="files-heading" title="Files" className="px-1" />
          <Card padding="dense">
            <p className="text-small text-ink-muted">
              No files on this goal yet. What Dash writes for it, and what you add, lands here.
            </p>
          </Card>
        </section>
      )}
    </div>
  );
}

/**
 * A goal with no tiles laid out yet (plan #2778.4): one line saying so, with
 * Ask Dash to lay them out. Laying out is plan #2778.9's; until then the
 * press asks Dash on the goal, as Ask Dash does.
 */
export function NoLayoutLine({ ask }: { ask?: React.ReactNode }) {
  return (
    <Card padding="standard" className="space-y-2">
      <p className="text-ui text-ink">This goal has no dashboard yet.</p>
      <p className="text-small text-ink-muted">
        Dash can pick the tiles that fit it: the numbers, dates and lists it is measured by.
      </p>
      {ask}
    </Card>
  );
}
