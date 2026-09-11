import Link from 'next/link';
import { CalendarClock } from 'lucide-react';
import { requireUser } from '@/lib/auth/server';
import { createClient as createShoppingClient } from '@/lib/auth/server';
import { createClient as createJobsClient } from '@/lib/jobs/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { MODULES, type ModuleId } from '@/lib/modules';
import { AppShell } from '@/components/shell/app-shell';
import { ModuleMark } from '@/components/ui/module-mark';
import { Card, cardVariants } from '@/components/ui/card';
import { Banner } from '@/components/ui/banner';
import { EmptyState } from '@/components/ui/empty-state';
import { describeCount, loadModuleCounts } from '@/lib/modules/counts';
import { switcherCounts } from '@/lib/modules/switcher-counts';
import { loadRaisedNotifications } from '@/lib/raised/notifications';
import { loadAccountSettings, moduleEnabled } from '@/lib/core/account/settings';
import { loadAgenda } from '@/lib/todo/agenda/load';
import { BUCKET_LABELS } from '@/lib/todo/tasks/model';
import { countReviewItems as countShoppingReview } from '@/lib/review/load';
import { countReviewItems as countJobsReview } from '@/lib/jobs/review/load';
import {
  loadJobsBrief,
  loadLearnBrief,
  loadShoppingBrief,
  loadTodoBrief,
  loadVaultBrief,
  type Brief,
} from '@/lib/shell/brief';
import { cn } from '@/lib/cn';

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
 * set large, then the one sentence each workspace would say if it could say
 * only one -- the same brief that sits in each workspace's top bar, gathered
 * here in one column. That is the question none of the modules can answer on
 * its own: what, across all of them, needs me today.
 *
 * A quiet day looks quiet. When no workspace has anything to say, the column
 * is the day's sigil and one line, not five rows of "nothing". The agenda's
 * overdue and due-today entries follow, capped, because they are the one list
 * worth seeing before choosing a room. The tiles come last and are small:
 * they are doors, and doors do not need to be the biggest thing in the hall.
 *
 * A module switched off under Account is not listed anywhere here. That is
 * what the switch means.
 */
export default async function HomePage() {
  const user = await requireUser();
  const settings = await loadAccountSettings(user.id);
  const now = new Date();
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: settings.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);

  const [counts, raised, agenda, shopping, core, jobs] = await Promise.all([
    loadModuleCounts(user.id),
    loadRaisedNotifications(user.id),
    // The agenda reads three schemas; a failure in any of them must cost this
    // page a section, not the whole front door.
    loadAgenda(user.id).catch(() => null),
    createShoppingClient(),
    createCoreClient(),
    createJobsClient(),
  ]);

  const enabled = MODULES.filter((module) => moduleEnabled(settings, module.id));
  const on = (id: ModuleId) => enabled.some((module) => module.id === id);

  // Each brief already swallows its own failures; the review counts feed two
  // of them and are guarded here for the same reason.
  const [shoppingReview, jobsReview] = await Promise.all([
    on('shopping') ? safe(countShoppingReview(shopping, core, user.id), 0) : 0,
    on('jobs') ? safe(countJobsReview(jobs, core, user.id), 0) : 0,
  ]);

  const loaded = await Promise.all([
    on('shopping')
      ? safe(loadShoppingBrief(user.id, settings.timezone, shoppingReview), null)
      : null,
    on('jobs') ? safe(loadJobsBrief(user.id, jobsReview), null) : null,
    on('todo') ? safe(loadTodoBrief(user.id, settings.timezone), null) : null,
    on('vault') ? safe(loadVaultBrief(), null) : null,
    on('learn') ? safe(loadLearnBrief(), null) : null,
  ]);
  // The dev workspace has no brief of its own yet: its queue is the feedback
  // list, and the button in the header already says how long it is.
  const paired: ReadonlyArray<readonly [ModuleId, Brief | null]> = [
    ['shopping', loaded[0]],
    ['jobs', loaded[1]],
    ['todo', loaded[2]],
    ['vault', loaded[3]],
    ['learn', loaded[4]],
  ];
  const briefs = paired.filter(
    (entry): entry is readonly [ModuleId, Brief] => entry[1] !== null,
  );

  // Overdue and today only, capped. Everything else is a page away.
  const due = (agenda?.piles ?? [])
    .filter((pile) => pile.bucket === 'overdue' || pile.bucket === 'today')
    .flatMap((pile) => pile.entries.map((entry) => ({ bucket: pile.bucket, entry })))
    .slice(0, 5);

  // What today already holds -- an event you typed, an interview -- above the
  // things to do, and without a checkbox for the same reason the agenda gives
  // it none. Today only: the merge already drops anything earlier, because an
  // appointment in the past is over rather than late.
  const happening = (agenda?.piles ?? [])
    .filter((pile) => pile.bucket === 'today')
    .flatMap((pile) => pile.context)
    .slice(0, 5);

  const date = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: settings.timezone,
  }).format(now);

  return (
    <div className="min-h-full">
      <AppShell
        module={null}
        sections={[]}
        displayName={settings.displayName}
        email={user.email ?? ''}
        enabledModules={settings.enabledModules}
        counts={switcherCounts(counts)}
        theme={settings.theme}
        notifications={raised}
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

          {agenda === null && (
            <Banner tone="bad" className="mt-6">
              The agenda could not be read just now, so anything due today is missing from this
              page.
            </Banner>
          )}

          {briefs.length > 0 ? (
            <ul className="mt-2 divide-y divide-border">
              {briefs.map(([module, brief]) => (
                <li key={module} className="flex items-center gap-3 py-3.5">
                  <ModuleMark module={module} size="sm" />
                  {brief.href ? (
                    <Link
                      href={brief.href}
                      className="min-w-0 flex-1 truncate text-lead text-ink hover:text-accent"
                    >
                      {brief.text}
                    </Link>
                  ) : (
                    <span className="min-w-0 flex-1 truncate text-lead text-ink">{brief.text}</span>
                  )}
                  {brief.tone === 'caution' && (
                    <span className="size-2 shrink-0 rounded-full bg-caution-fill" aria-hidden />
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              tone="finished"
              seed={`${user.id}:${today}:home`}
              title="Nothing needs you."
              description="Every workspace is quiet. Whatever you do next is your choice, not the app's."
            />
          )}

          {/* Nothing at all when there is nothing at all -- no "0 things due",
              no empty card. */}
          {(due.length > 0 || happening.length > 0) && (
            <Card padding="standard" className="mt-4">
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="text-ui font-semibold text-ink">Today</h2>
                <Link
                  href="/todo"
                  className="text-small font-medium text-accent underline underline-offset-2"
                >
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
                      <CalendarClock
                        className="size-3.5 shrink-0 text-accent"
                        strokeWidth={1.75}
                        aria-hidden
                      />
                      {entry.at && (
                        <span className="tabular font-medium">
                          {new Intl.DateTimeFormat('en-GB', {
                            timeZone: settings.timezone,
                            hour: '2-digit',
                            minute: '2-digit',
                          }).format(new Date(entry.at))}
                        </span>
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
                      {/* Each line goes where the thing itself lives: a task to
                          its own row on the agenda, a source item to whatever it
                          is about. They were plain text, which made the list
                          something to read and then go and find by hand. */}
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
            </Card>
          )}

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
        </div>
      </AppShell>
    </div>
  );
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
