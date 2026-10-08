import type { ReactNode } from 'react';
import Link from '@/components/ui/link';
import { CalendarClock } from 'lucide-react';
import { MainRail } from '@/components/patterns/main-rail';
import { Card } from '@/components/ui/card';
import { ModuleMark } from '@/components/ui/module-mark';
import { formatClock } from '@/lib/clock';
import { ARRIVE_LAST_STEP, arriveAt } from '@/lib/home/first-visit';
import type { ModuleId } from '@/lib/modules';
import type { Brief } from '@/lib/shell/brief';
import { whenLabel, type Update } from '@/lib/shell/home-model';
import { BUCKET_LABELS } from '@/lib/todo/tasks/model';
import { HomeArrival } from './arrival';
import { WatchMark } from './watching';

/**
 * What Home draws, without what it reads (plan #1627). The page
 * (app/home/page.tsx) awaits each section in its own Suspense boundary and
 * hands the rows to these; the gallery's whole-page surface (`home-page` in
 * app/preview/surfaces.tsx) hands them fixtures, so the critic judges the
 * page the app serves.
 */

/**
 * Home on the main-plus-rail pattern (components/patterns/main-rail.tsx).
 * The header and what you work through (the briefs, Today, Updates) are the
 * main column; what you glance at (Watching, what Dash did, the week, the
 * workspaces) is the rail, on the right from laptop width and under the main
 * column on a phone.
 *
 * The first visit of the day still arrives in order (plan #1558): the header
 * marks its own steps, and the rest of the main column and the rail rise
 * together on the last one.
 */
export function HomeColumns({
  arrive,
  day,
  remember,
  header,
  main,
  rail,
}: {
  arrive: boolean;
  day: string;
  remember?: boolean;
  header: ReactNode;
  main: ReactNode;
  rail: ReactNode;
}) {
  return (
    <HomeArrival arrive={arrive} day={day} remember={remember}>
      <MainRail
        main={
          <>
            {header}
            <div data-arrive="" style={arriveAt(ARRIVE_LAST_STEP)}>
              {main}
            </div>
          </>
        }
        rail={
          <div data-arrive="" style={arriveAt(ARRIVE_LAST_STEP)} className="flex flex-col gap-4">
            {rail}
          </div>
        }
      />
    </HomeArrival>
  );
}

/** The greeting, the date with the day's sigil beside it, and this morning's brief. */
export function HomeHeader({
  greeting,
  date,
  sigil,
  brief,
}: {
  greeting: string;
  date: string;
  sigil?: ReactNode;
  brief?: ReactNode;
}) {
  return (
    <header className="border-b border-border-strong pb-6 pt-2">
      <p data-arrive="" style={arriveAt(0)} className="text-ui text-ink-muted">
        {greeting}
      </p>
      <div data-arrive="" style={arriveAt(1)} className="mt-1 flex items-center justify-between gap-4">
        <h1 className="font-display text-figure-lg font-semibold tracking-[-0.04em] text-ink sm:text-figure-xl">
          {date}
        </h1>
        {sigil}
      </div>
      <div data-arrive="" style={arriveAt(2)}>
        {brief}
      </div>
    </header>
  );
}

export interface HomeWorkspace {
  id: ModuleId;
  label: string;
  href: string;
}

/**
 * The doors, as marks, right under the date: for when you came to get to one
 * particular workspace. Marks only, named for a screen reader and on hover.
 * The rail's list is the considered version, with what is waiting in each.
 */
export function WorkspaceMarks({ workspaces }: { workspaces: readonly HomeWorkspace[] }) {
  if (workspaces.length === 0) return null;
  return (
    <nav aria-label="Jump to a workspace" className="mt-4 flex flex-wrap items-center gap-2">
      {workspaces.map((workspace) => (
        <Link
          key={workspace.id}
          href={workspace.href}
          title={workspace.label}
          className="press press-area rounded-[8px] transition-opacity duration-quick hover:opacity-75"
        >
          <ModuleMark module={workspace.id} size="md" />
          <span className="sr-only">{workspace.label}</span>
        </Link>
      ))}
    </nav>
  );
}

/** One workspace's line: the one sentence it would say if it could say only one. */
export function BriefLine({ module, brief }: { module: ModuleId; brief: Brief }) {
  return (
    <li className="flex items-center gap-3 py-3.5">
      <ModuleMark module={module} size="sm" />
      {brief.href ? (
        // The words truncate inside the link rather than the link itself, so
        // its 44px press area (press-area) is not clipped with them.
        <Link href={brief.href} className="press-area min-w-0 flex-1 text-body text-ink hover:text-accent">
          <span className="block truncate">{brief.text}</span>
        </Link>
      ) : (
        <span className="min-w-0 flex-1 truncate text-body text-ink">{brief.text}</span>
      )}
      {brief.tone === 'caution' && <span className="size-2 shrink-0 rounded-full bg-caution-fill" aria-hidden />}
    </li>
  );
}

/** Something today already holds, such as an event you typed or an interview. */
export interface TodayHappening {
  key: string;
  at: string | null;
  label: string;
  detail: string | null;
  href: string | null;
}

/** A thing due today or overdue, linked to where it lives. */
export interface TodayDue {
  key: string;
  overdue: boolean;
  title: string;
  href: string;
}

/**
 * Overdue and today only, capped, with a count of the rest so the cap is not
 * mistaken for all. What today already holds goes above the things to do,
 * without a checkbox. The page leaves it out when there is nothing.
 */
export function TodayCard({
  happening,
  due,
  more,
  timezone,
}: {
  happening: readonly TodayHappening[];
  due: readonly TodayDue[];
  more: number;
  timezone: string;
}) {
  return (
    <Card padding="standard" className="mt-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-ui font-semibold text-ink">Today</h2>
        <Link href="/todo" className="press-area text-small font-medium text-accent underline underline-offset-2">
          The agenda
        </Link>
      </div>
      {happening.length > 0 && (
        <ul className="mt-2 space-y-1">
          {happening.map((entry) => (
            <li
              key={entry.key}
              className="flex flex-wrap items-baseline gap-x-2 rounded-lg bg-accent-tint px-3 py-1.5 text-small text-ink"
            >
              <CalendarClock className="size-3.5 shrink-0 text-accent" strokeWidth={1.75} aria-hidden />
              {entry.at && <span className="tabular font-medium">{formatClock(entry.at, { timeZone: timezone })}</span>}
              {entry.href ? (
                <Link href={entry.href} className="press-area font-medium hover:text-accent">
                  {entry.label}
                </Link>
              ) : (
                <span className="font-medium">{entry.label}</span>
              )}
              {entry.detail && <span className="text-ink-muted">{entry.detail}</span>}
            </li>
          ))}
        </ul>
      )}

      {due.length > 0 && (
        <ul className="mt-2 divide-y divide-border">
          {due.map((entry) => (
            <li key={entry.key} className="flex items-baseline gap-2 py-1.5">
              {entry.overdue && (
                <span className="shrink-0 text-micro font-medium text-danger">{BUCKET_LABELS.overdue}</span>
              )}
              {/* Each line goes where the thing itself lives: a task to its own
                  row on the agenda, a source item to whatever it is about. */}
              <Link href={entry.href} className="press-area min-w-0 flex-1 text-ui text-ink hover:text-accent">
                <span className="block truncate">{entry.title}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {more > 0 && (
        <Link href="/todo" className="press-area mt-2 block text-small text-ink-muted hover:text-accent">
          {more} more on the agenda
        </Link>
      )}
    </Card>
  );
}

/** One line of the coming week: something booked, or something falling due. */
export interface WeekRow {
  key: string;
  /** The day it falls on, already the reader's. */
  day: string | null;
  at: string | null;
  label: string;
  detail: string | null;
  href: string;
  booked: boolean;
}

/** "Tue 29", for a day in the coming week. The day is already the reader's. */
function dayLabel(day: string): string {
  return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${day}T00:00:00Z`),
  );
}

/**
 * The next seven days after today, in the rail: what is booked and what falls
 * due, so a Tuesday interview is seen on Saturday. A title wraps rather than
 * being cut, since the rail is narrow. The page leaves it out when nothing is
 * coming.
 */
export function WeekCard({ rows, timezone }: { rows: readonly WeekRow[]; timezone: string }) {
  return (
    <Card padding="standard">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-ui font-semibold text-ink">This week</h2>
        <Link href="/todo" className="press-area text-small font-medium text-accent underline underline-offset-2">
          The agenda
        </Link>
      </div>
      <ul className="mt-2 divide-y divide-border">
        {rows.map((row) => (
          <li key={row.key} className="flex items-baseline gap-2 py-1.5">
            <span className="tabular w-20 shrink-0 text-small text-ink-muted">
              {row.day ? dayLabel(row.day) : ''}
              {row.booked && row.at ? ` ${formatClock(row.at, { timeZone: timezone })}` : ''}
            </span>
            {/* Every row keeps the icon's slot, so the titles share one left
                edge; the slot sits on the first line's baseline. */}
            <span className="inline-block w-3.5 shrink-0">
              {row.booked && (
                <CalendarClock className="block size-3.5 text-accent" strokeWidth={1.75} aria-hidden />
              )}
            </span>
            <Link href={row.href} className="press-area min-w-0 flex-1 text-ui text-ink hover:text-accent">
              {row.label}
              {row.detail && <span className="text-ink-muted"> · {row.detail}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/**
 * What happened in the last three days: replies, orders, the newsletters that
 * came in, and any watch that finished. Each line names the thing. The page
 * leaves it out when nothing happened.
 */
export function UpdatesCard({
  updates,
  now,
  timezone,
}: {
  updates: readonly Update[];
  now: Date;
  timezone: string;
}) {
  return (
    <Card padding="standard" className="mt-4">
      <h2 className="text-ui font-semibold text-ink">Updates</h2>
      <ul className="mt-2 divide-y divide-border">
        {updates.map((update) => {
          const body = (
            <>
              <span className="block truncate text-ui text-ink">{update.text}</span>
              {update.detail && <span className="block truncate text-small text-ink-muted">{update.detail}</span>}
            </>
          );
          return (
            <li key={update.key} className="flex items-center gap-3 py-2">
              {update.module ? <ModuleMark module={update.module} size="sm" /> : <WatchMark />}
              {update.href ? (
                <Link href={update.href} className="press-area min-w-0 flex-1 hover:opacity-80">
                  {body}
                </Link>
              ) : (
                <span className="min-w-0 flex-1">{body}</span>
              )}
              <span className="tabular shrink-0 text-small text-ink-muted">{whenLabel(update.at, now, timezone)}</span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

export interface WorkspaceEntry extends HomeWorkspace {
  /** What is waiting in it (describeCount), or what it is for when nothing is. */
  stat: string;
}

/**
 * Every workspace with what is waiting in it, at the foot of the rail. A list
 * rather than the tiles it was, since three tiles across do not fit the
 * rail's 18rem.
 */
export function WorkspaceList({ workspaces }: { workspaces: readonly WorkspaceEntry[] }) {
  if (workspaces.length === 0) return null;
  return (
    <Card padding="standard">
      <nav aria-label="Workspaces in full">
        <h2 className="text-ui font-semibold text-ink">Workspaces</h2>
        <ul className="mt-2 divide-y divide-border">
          {workspaces.map((workspace) => (
            <li key={workspace.id}>
              <Link
                href={workspace.href}
                className="group flex items-center gap-3 py-2 transition-opacity duration-quick hover:opacity-80"
              >
                <ModuleMark module={workspace.id} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block text-ui font-medium text-ink group-hover:text-accent">{workspace.label}</span>
                  <span className="tabular block truncate text-small text-ink-muted">{workspace.stat}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </Card>
  );
}
