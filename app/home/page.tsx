import { Suspense } from 'react';
import Link from '@/components/ui/link';
import { CalendarClock } from 'lucide-react';
import { requireUser } from '@/lib/auth/server';
import { createClient as createShoppingClient } from '@/lib/auth/server';
import { createClient as createJobsClient } from '@/lib/jobs/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { modulesFor, type ModuleId } from '@/lib/modules';
import { AppShell } from '@/components/shell/app-shell';
import { ModuleMark } from '@/components/ui/module-mark';
import { Card, cardVariants } from '@/components/ui/card';
import { Banner } from '@/components/ui/banner';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { describeCount, loadModuleCounts } from '@/lib/modules/counts';
import { switcherCounts } from '@/lib/modules/switcher-counts';
import { loadRaisedNotifications } from '@/lib/raised/notifications';
import { loadMainCheck } from '@/lib/shell/main-check';
import { loadAccountSettings, moduleEnabled } from '@/lib/core/account/settings';
import { isOwner } from '@/lib/dev/owner';
import { loadAgenda, type Agenda } from '@/lib/todo/agenda/load';
import { BUCKET_LABELS, dueDay } from '@/lib/todo/tasks/model';
import { countReviewItems as countShoppingReview } from '@/lib/review/load';
import { countReviewItems as countJobsReview } from '@/lib/jobs/review/load';
import {
  loadGoalsBrief,
  loadJobsBrief,
  loadNewsBrief,
  loadLearnBrief,
  loadShoppingBrief,
  loadTodoBrief,
  loadVaultBrief,
  type Brief,
} from '@/lib/shell/brief';
import { loadUpdates } from '@/lib/shell/updates';
import { loadWatching } from '@/lib/shell/watching';
import { mergeUpdates, whenLabel } from '@/lib/shell/home-model';
import { cn } from '@/lib/cn';
import { observationWeek } from '@/lib/timeline/observations';
import { readObservations } from '@/lib/timeline/observations-load';
import type { ShownObservation } from '@/lib/timeline/observations-view';
import { ObservationList } from '@/app/timeline/observations';
import { formatClock } from '@/lib/clock';
import { BRIEF_ANCHOR, shownBrief, type ShownBrief } from '@/lib/day-brief/shown';
import { openedFromPush } from '@/lib/day-brief/opens';
import { DayBrief } from './day-brief';
import { WatchingSection, WatchMark } from './watching';

export const metadata = { title: 'Home' };

async function safe<T>(work: PromiseLike<T>, fallback: T): Promise<T> {
  try {
    return await work;
  } catch {
    return fallback;
  }
}

/**
 * What time of day it is where the reader is, not where the server is.
 */
function greeting(timezone: string, now: Date): string {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: timezone }).format(
      now,
    ),
  );
  if (hour < 5) return 'Still up';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/**
 * The front door to the account, not to any one module.
 *
 * It reads like this morning's front page rather than a launcher: the date,
 * set large, with this morning's brief under it once the day-brief cron has
 * written one (plan #1123), then the one sentence each workspace would say if it could say
 * only one -- the same brief that sits in each workspace's top bar, gathered
 * here in one column. That is the question none of the modules can answer on
 * its own: what, across all of them, needs me today. Under it, in a week
 * the Monday run found something, up to three observations across the
 * workspaces, each with the rows behind it.
 *
 * A quiet day looks quiet. When no workspace has anything to say, the column
 * is the day's sigil and one line, not five rows of "nothing". The agenda's
 * overdue and due-today entries follow, capped, with a count of the rest.
 * Then the next seven days from the same agenda (interviews, events, return
 * deadlines, tasks), and then what changed in the last three days: replies
 * from companies, new orders, newsletters that arrived. Each of those cards
 * is left out when it has nothing in it. The tiles come last and are small,
 * because they are only there to get you into a workspace.
 *
 * A module switched off under Account is not listed anywhere here. That is
 * what the switch means.
 */
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // The frame: who you are, your settings, which workspaces are on, and what
  // the shell itself needs. One round of reads, the same one every workspace's
  // layout makes, and the only thing the greeting waits for. Everything under
  // the date is started here and awaited in its own section below (plan
  // #1443), so a slow agenda or brief costs that section and nothing else.
  const user = await requireUser();
  const [settings, counts, raised, mainCheck, owner, shopping, core, jobs, params] =
    await Promise.all([
      loadAccountSettings(user.id),
      loadModuleCounts(user.id),
      loadRaisedNotifications(user.id),
      loadMainCheck(),
      isOwner({ user }),
      createShoppingClient(),
      createCoreClient(),
      createJobsClient(),
      searchParams,
    ]);
  const now = new Date();
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: settings.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);

  // The tiles are the third list of workspaces, after the switcher and the
  // account page, and they go through the same rule: a workspace this account
  // may not see is not a door with a locked room behind it, it is not a door.
  const enabled = modulesFor(owner).filter((module) => moduleEnabled(settings, module.id));
  const on = (id: ModuleId) => enabled.some((module) => module.id === id);

  // Started, not awaited. Each promise below already swallows its own
  // failures, so none of them can reject while no section is waiting on it.

  // The agenda reads three schemas; a failure in any of them must cost this
  // page a section, not the whole front door. Today, This week and the banner
  // all read this one promise.
  const agenda = loadAgenda(user.id).catch(() => null);

  // Each brief already swallows its own failures; the review counts feed two
  // of them and are guarded here for the same reason.
  const shoppingReview = on('shopping') ? safe(countShoppingReview(shopping, core, user.id), 0) : Promise.resolve(0);
  const jobsReview = on('jobs') ? safe(countJobsReview(jobs, core, user.id), 0) : Promise.resolve(0);
  // The dev workspace has no brief of its own yet: its queue is the feedback
  // list, and the button in the header already says how long it is.
  const briefs: ReadonlyArray<readonly [ModuleId, Promise<Brief | null>]> = (
    [
      [
        'shopping',
        () =>
          shoppingReview.then((review) =>
            safe(loadShoppingBrief(user.id, settings.timezone, review), null),
          ),
      ],
      ['jobs', () => jobsReview.then((review) => safe(loadJobsBrief(user.id, review), null))],
      ['todo', () => safe(loadTodoBrief(user.id, settings.timezone), null)],
      ['vault', () => safe(loadVaultBrief(), null)],
      ['learn', () => safe(loadLearnBrief(), null)],
      ['goals', () => safe(loadGoalsBrief(user.id, settings.timezone), null)],
      ['news', () => safe(loadNewsBrief(), null)],
    ] as const
  )
    .filter(([module]) => on(module))
    .map(([module, load]) => [module, load()] as const);

  // This week's observations (plan #1120): the rows the Monday run wrote.
  const thisWeek = observationWeek(now).week;
  const nextWeek = new Date(Date.parse(`${thisWeek}T00:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10);
  const observations = safe(
    readObservations(shopping, { fromWeek: thisWeek, toWeek: nextWeek }),
    [],
  );

  // The feed swallows its own failures per source, and this guards the rest.
  const feed = safe(loadUpdates(user.id, on, now), []);
  // What Dash is watching (plan #1295): the running watches for their
  // section, and any that finished lately as lines for Updates.
  const watching = safe(loadWatching(now), { running: [], ended: [] });

  // Opened from the morning notification (plan #1242): stamp that day's brief
  // as opened, once. Any other visit carries no from=push and records nothing.
  const openedDay = openedFromPush(params, today);
  const opened = openedDay ? safe(core.rpc('open_day_brief', { p_day: openedDay }), null) : null;

  // This morning's brief (plan #1123), written by the hourly day-brief cron
  // from six in the person's zone. Before then there is none, and the page
  // opens on the date as it always did. Since #1241 it is the picks, with
  // an older row shown by its body (lib/day-brief/shown.ts).
  const dayBrief = safe(
    core
      .from('day_briefs')
      .select('body, picks')
      .eq('user_id', user.id)
      .eq('day', today)
      .maybeSingle()
      .then((result) =>
        shownBrief(
          result.data ? { body: result.data.body as string | null, picks: result.data.picks } : null,
        ),
      ),
    null,
  );

  const date = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: settings.timezone,
  }).format(now);

  return (
    <div className="min-h-full">
      <AppShell
        account={user.id}
        module={null}
        sections={[]}
        displayName={settings.displayName}
        email={user.email ?? ''}
        enabledModules={settings.enabledModules}
        isOwner={owner}
        counts={switcherCounts(counts)}
        theme={settings.theme}
        notifications={raised}
        mainCheck={mainCheck}
      >
        <div className="mx-auto max-w-3xl">
          <header className="border-b border-border-strong pb-6 pt-2">
            <p className="text-ui text-ink-muted">
              {greeting(settings.timezone, now)}
              {settings.displayName ? `, ${settings.displayName.split(' ')[0]}` : ''}
            </p>
            <h1 className="font-display mt-1 text-figure-lg font-semibold tracking-[-0.04em] text-ink sm:text-figure-xl">
              {date}
            </h1>
            {/* The fallback carries the brief's anchor, so the morning
                notification's #brief has somewhere to land before the brief
                itself does. */}
            <Suspense
              fallback={
                <div id={BRIEF_ANCHOR} className="mt-4 scroll-mt-20 space-y-2.5" aria-hidden>
                  <Skeleton className="h-4 w-72 max-w-full" />
                  <Skeleton className="h-3 w-56 max-w-full" />
                </div>
              }
            >
              <DayBriefSection brief={dayBrief} opened={opened} day={today} />
            </Suspense>
          </header>

          {/* The doors, as marks, right under the date.
              The tiles at the foot of the page are the considered version --
              each with its name and what is waiting in it -- and they stay,
              because that is what you read when you are deciding where to go.
              This row is for when you are not deciding: you came here to get
              to one particular workspace, and it should not be a scroll away.
              Marks only, named for a screen reader and on hover. */}
          {enabled.length > 0 && (
            <nav aria-label="Jump to a workspace" className="mt-4 flex flex-wrap items-center gap-2">
              {enabled.map((module) => (
                <Link
                  key={module.id}
                  href={module.home}
                  title={module.label}
                  className="press rounded-[8px] transition-opacity duration-150 hover:opacity-75"
                >
                  <ModuleMark module={module.id} size="md" />
                  <span className="sr-only">{module.label}</span>
                </Link>
              ))}
            </nav>
          )}

          <Suspense fallback={null}>
            <AgendaBanner agenda={agenda} />
          </Suspense>

          {/* One line per workspace, each landing when its own brief does. A
              workspace with nothing to say takes its placeholder away. */}
          <ul className="mt-2 divide-y divide-border">
            {briefs.map(([module, brief]) => (
              <Suspense key={module} fallback={<BriefRowSkeleton module={module} />}>
                <BriefRow module={module} brief={brief} />
              </Suspense>
            ))}
          </ul>
          <Suspense fallback={null}>
            <QuietDay
              briefs={briefs.map(([, brief]) => brief)}
              seed={`${user.id}:${today}:home`}
            />
          </Suspense>

          <Suspense fallback={<SectionSkeleton rows={2} />}>
            <ObservationsSection observations={observations} timezone={settings.timezone} />
          </Suspense>

          <Suspense fallback={<SectionSkeleton rows={3} />}>
            <TodaySection agenda={agenda} timezone={settings.timezone} />
          </Suspense>

          <Suspense fallback={<SectionSkeleton rows={3} />}>
            <WeekSection agenda={agenda} timezone={settings.timezone} />
          </Suspense>

          {/* The fallback carries #watching, where every watch push opens. */}
          <Suspense fallback={<SectionSkeleton rows={1} id="watching" />}>
            <WatchingBlock watching={watching} now={now} timezone={settings.timezone} />
          </Suspense>

          <Suspense fallback={<SectionSkeleton rows={4} />}>
            <UpdatesSection feed={feed} watching={watching} now={now} timezone={settings.timezone} />
          </Suspense>

          <nav
            aria-label="Workspaces in full"
            className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
          >
            {enabled.map((module) => (
              <ModuleCard
                key={module.id}
                href={module.home}
                module={module.id}
                title={module.label}
                stat={describeCount(counts[module.id]) || module.description}
              />
            ))}
          </nav>

          <Suspense fallback={null}>
            <ReviewLinks observations={observations} />
          </Suspense>
        </div>
      </AppShell>
    </div>
  );
}

/** This morning's brief, and the stamp that it was opened from the push. */
async function DayBriefSection({
  brief,
  opened,
  day,
}: {
  brief: Promise<ShownBrief | null>;
  opened: Promise<unknown> | null;
  day: string;
}) {
  const [shown] = await Promise.all([brief, opened]);
  return shown ? <DayBrief brief={shown} day={day} /> : null;
}

async function AgendaBanner({ agenda }: { agenda: Promise<Agenda | null> }) {
  if ((await agenda) !== null) return null;
  return (
    <Banner tone="bad" className="mt-6">
      The agenda could not be read just now, so anything due today is missing from this page.
    </Banner>
  );
}

/** The placeholder for one workspace's line: its mark is known already. */
function BriefRowSkeleton({ module }: { module: ModuleId }) {
  return (
    <li className="flex items-center gap-3 py-3.5" aria-hidden>
      <ModuleMark module={module} size="sm" />
      <Skeleton className="h-4 w-1/2" />
    </li>
  );
}

async function BriefRow({ module, brief }: { module: ModuleId; brief: Promise<Brief | null> }) {
  const shown = await brief;
  if (!shown) return null;
  return (
    <li className="flex items-center gap-3 py-3.5">
      <ModuleMark module={module} size="sm" />
      {shown.href ? (
        <Link href={shown.href} className="min-w-0 flex-1 truncate text-body text-ink hover:text-accent">
          {shown.text}
        </Link>
      ) : (
        <span className="min-w-0 flex-1 truncate text-body text-ink">{shown.text}</span>
      )}
      {shown.tone === 'caution' && (
        <span className="size-2 shrink-0 rounded-full bg-caution-fill" aria-hidden />
      )}
    </li>
  );
}

/**
 * A quiet day looks quiet: when no workspace has anything to say, the column
 * is the day's sigil and one line. It can only know that once every brief is
 * in, so it is the one part of the column that waits on all of them.
 */
async function QuietDay({
  briefs,
  seed,
}: {
  briefs: ReadonlyArray<Promise<Brief | null>>;
  seed: string;
}) {
  const loaded = await Promise.all(briefs);
  if (loaded.some((brief) => brief !== null)) return null;
  return (
    <EmptyState
      tone="finished"
      seed={seed}
      title="Nothing needs you."
      description="Every workspace is quiet. Whatever you do next is your choice, not the app's."
    />
  );
}

/**
 * The shape of a card section while its data is on its way: a heading and a
 * few rows, so the page does not jump when the card lands.
 */
function SectionSkeleton({ rows, id }: { rows: number; id?: string }) {
  return (
    <Card id={id} padding="standard" className="mt-4 scroll-mt-20" aria-hidden>
      <Skeleton className="h-4 w-32" />
      <div className="mt-2 divide-y divide-border">
        {Array.from({ length: rows }).map((_, index) => (
          <div key={index} className="py-2">
            <Skeleton className="h-4" style={{ width: `${70 - index * 10}%` }} />
          </div>
        ))}
      </div>
    </Card>
  );
}

/**
 * What the weekly run noticed across the workspaces, under the briefs because
 * it is about the same question from further back. A week it had nothing to
 * say leaves no card, not an empty one.
 */
async function ObservationsSection({
  observations,
  timezone,
}: {
  observations: Promise<ShownObservation[]>;
  timezone: string;
}) {
  const rows = await observations;
  if (rows.length === 0) return null;
  return (
    <Card padding="standard" className="mt-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-ui font-semibold text-ink">What Dash noticed this week</h2>
        <span className="flex items-baseline gap-3">
          {/* The Sunday review (plan #1233) sits beside these rather than
              repeating them. */}
          <Link
            href="/home/week"
            className="text-small font-medium text-accent underline underline-offset-2"
          >
            Week in review
          </Link>
          <Link
            href="/timeline"
            className="text-small font-medium text-accent underline underline-offset-2"
          >
            Timeline
          </Link>
        </span>
      </div>
      <div className="mt-2">
        <ObservationList observations={rows} timezone={timezone} />
      </div>
    </Card>
  );
}

/**
 * Overdue and today only, capped. Everything else is a page away, and the
 * card says how much of it there is so the cap is not mistaken for all.
 * Nothing at all when there is nothing at all -- no "0 things due", no empty
 * card.
 */
async function TodaySection({
  agenda,
  timezone,
}: {
  agenda: Promise<Agenda | null>;
  timezone: string;
}) {
  const piles = (await agenda)?.piles ?? [];
  const dueAll = piles
    .filter((pile) => pile.bucket === 'overdue' || pile.bucket === 'today')
    .flatMap((pile) => pile.entries.map((entry) => ({ bucket: pile.bucket, entry })));
  const due = dueAll.slice(0, 5);
  const dueMore = dueAll.length - due.length;

  // What today already holds -- an event you typed, an interview -- above the
  // things to do, and without a checkbox for the same reason the agenda gives
  // it none. Today only: the merge already drops anything earlier, because an
  // appointment in the past is over rather than late.
  const happening = piles
    .filter((pile) => pile.bucket === 'today')
    .flatMap((pile) => pile.context)
    .slice(0, 5);

  if (due.length === 0 && happening.length === 0) return null;
  return (
    <Card padding="standard" className="mt-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-ui font-semibold text-ink">Today</h2>
        <Link href="/todo" className="text-small font-medium text-accent underline underline-offset-2">
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
              {entry.at && (
                <span className="tabular font-medium">{formatClock(entry.at, { timeZone: timezone })}</span>
              )}
              {entry.link ? (
                <Link href={entry.link.href} className="font-medium hover:text-accent">
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
          {due.map(({ bucket, entry }) => (
            <li key={entry.key} className="flex items-baseline gap-2 py-1.5">
              {bucket === 'overdue' && (
                <span className="shrink-0 text-micro font-medium text-danger">
                  {BUCKET_LABELS.overdue}
                </span>
              )}
              {/* Each line goes where the thing itself lives: a task to its own
                  row on the agenda, a source item to whatever it is about. They
                  were plain text, which made the list something to read and
                  then go and find by hand. */}
              <Link
                href={agendaHref(entry)}
                className="min-w-0 flex-1 truncate text-ui text-ink hover:text-accent"
              >
                {entry.task?.title ?? entry.item?.title}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {dueMore > 0 && (
        <Link href="/todo" className="mt-2 block text-small text-ink-muted hover:text-accent">
          {dueMore} more on the agenda
        </Link>
      )}
    </Card>
  );
}

/**
 * The next seven days after today, so a Tuesday interview is seen on Saturday
 * rather than on Tuesday: what is booked and what falls due. The agenda
 * already gathers interviews, return deadlines, events and tasks into its
 * "soon" pile, so this reads that pile rather than asking each workspace
 * again. Nothing when nothing is coming.
 */
async function WeekSection({
  agenda,
  timezone,
}: {
  agenda: Promise<Agenda | null>;
  timezone: string;
}) {
  const soonPile = ((await agenda)?.piles ?? []).find((pile) => pile.bucket === 'soon');
  const week = [
    ...(soonPile?.context ?? []).map((entry) => ({
      key: `context-${entry.key}`,
      day: entry.day,
      at: entry.at,
      label: entry.label,
      detail: entry.detail,
      href: entry.link?.href ?? '/todo',
      booked: true,
    })),
    ...(soonPile?.entries ?? []).map((entry) => ({
      key: `entry-${entry.key}`,
      day: (entry.task ? dueDay(entry.task, timezone) : entry.item?.day) ?? null,
      at: entry.task?.dueAt ?? entry.item?.at ?? null,
      label: entry.task?.title ?? entry.item?.title ?? '',
      detail: entry.item?.detail ?? null,
      href: agendaHref(entry),
      booked: false,
    })),
  ]
    .sort((a, b) => (a.day ?? '9999').localeCompare(b.day ?? '9999') || (a.at ?? '').localeCompare(b.at ?? ''))
    .slice(0, 6);

  if (week.length === 0) return null;
  return (
    <Card padding="standard" className="mt-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-ui font-semibold text-ink">This week</h2>
        <Link href="/todo" className="text-small font-medium text-accent underline underline-offset-2">
          The agenda
        </Link>
      </div>
      <ul className="mt-2 divide-y divide-border">
        {week.map((row) => (
          <li key={row.key} className="flex items-baseline gap-3 py-1.5">
            <span className="tabular w-20 shrink-0 text-small text-ink-muted">
              {row.day ? dayLabel(row.day) : ''}
              {row.booked && row.at ? ` ${timeLabel(row.at, timezone)}` : ''}
            </span>
            {row.booked && (
              <CalendarClock
                className="size-3.5 shrink-0 self-center text-accent"
                strokeWidth={1.75}
                aria-hidden
              />
            )}
            <Link href={row.href} className="min-w-0 flex-1 truncate text-ui text-ink hover:text-accent">
              {row.label}
              {row.detail && <span className="text-ink-muted"> · {row.detail}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

type Watching = Awaited<ReturnType<typeof loadWatching>>;

/**
 * What Dash is watching for you (plan #1295), where every watch push opens.
 * Absent when nothing is running.
 */
async function WatchingBlock({
  watching,
  now,
  timezone,
}: {
  watching: Promise<Watching>;
  now: Date;
  timezone: string;
}) {
  const { running } = await watching;
  if (running.length === 0) return null;
  return <WatchingSection rows={running} now={now} timezone={timezone} />;
}

/**
 * What happened in the last three days: replies, orders, the newsletters that
 * came in. Each line names the thing, so the page can be read without opening
 * a workspace to see what a count was counting. A watch that finished is said
 * once, here, beside everything else that happened; the Watching section only
 * ever holds what is still running.
 */
async function UpdatesSection({
  feed,
  watching,
  now,
  timezone,
}: {
  feed: Promise<Awaited<ReturnType<typeof loadUpdates>>>;
  watching: Promise<Watching>;
  now: Date;
  timezone: string;
}) {
  const [lines, watched] = await Promise.all([feed, watching]);
  const updates = mergeUpdates([lines, watched.ended]);
  if (updates.length === 0) return null;
  return (
    <Card padding="standard" className="mt-4">
      <h2 className="text-ui font-semibold text-ink">Updates</h2>
      <ul className="mt-2 divide-y divide-border">
        {updates.map((update) => {
          const body = (
            <>
              <span className="block truncate text-ui text-ink">{update.text}</span>
              {update.detail && (
                <span className="block truncate text-small text-ink-muted">{update.detail}</span>
              )}
            </>
          );
          return (
            <li key={update.key} className="flex items-center gap-3 py-2">
              {update.module ? <ModuleMark module={update.module} size="sm" /> : <WatchMark />}
              {update.href ? (
                <Link href={update.href} className="min-w-0 flex-1 hover:opacity-80">
                  {body}
                </Link>
              ) : (
                <span className="min-w-0 flex-1">{body}</span>
              )}
              <span className="tabular shrink-0 text-small text-ink-muted">
                {whenLabel(update.at, now, timezone)}
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/**
 * Everything the workspaces hold, by month (plan #1118). A line rather than a
 * tile: it is not a workspace. The week's review (plan #1233) beside it. In a
 * week with observations both links sit on their card instead.
 */
async function ReviewLinks({ observations }: { observations: Promise<ShownObservation[]> }) {
  if ((await observations).length > 0) return null;
  return (
    <div className="mt-4 space-y-1 text-small text-ink-muted">
      <p>
        <Link href="/home/week" className="font-medium text-accent hover:underline">
          Week in review
        </Link>
        {': what Dash wrote on Sunday about the week before.'}
      </p>
      <p>
        <Link href="/timeline" className="font-medium text-accent hover:underline">
          Timeline
        </Link>
        {': what you did across the app, month by month.'}
      </p>
    </div>
  );
}

/** "Tue 29", for a day in the coming week. The day is already the reader's. */
function dayLabel(day: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${day}T00:00:00Z`));
}

function timeLabel(at: string, timezone: string): string {
  return formatClock(at, { timeZone: timezone });
}

/**
 * Where one line of "Today" goes when you click it.
 *
 * A task has no page of its own -- it is a row on the agenda, and that is the
 * only place it can be ticked off, rescheduled or edited -- so it links to
 * itself there by anchor. A source item is somebody else's row: a return
 * deadline belongs to the order, a reminder to the application, and its own
 * link says which. Anything a source did not give a link for falls back to the
 * agenda, which is at least the page it was read from.
 */
function agendaHref(entry: { task?: { id: string }; item?: { link: { href: string } | null } }): string {
  if (entry.task) return `/todo#task-${entry.task.id}`;
  return entry.item?.link?.href ?? '/todo';
}

/**
 * The same mark the switcher and Account use -- module glyph on the module's
 * own hue. Three lists of these is two too many.
 */
function ModuleCard({
  href,
  module,
  title,
  stat,
}: {
  href: string;
  module: ModuleId;
  title: string;
  stat: string;
}) {
  return (
    <Link href={href} className={cn(cardVariants({ interactive: true }), 'flex items-center gap-3 p-4')}>
      <ModuleMark module={module} size="md" />
      <span className="min-w-0">
        <span className="block text-ui font-semibold text-ink">{title}</span>
        <span className="tabular block truncate text-small text-ink-muted">{stat}</span>
      </span>
    </Link>
  );
}
