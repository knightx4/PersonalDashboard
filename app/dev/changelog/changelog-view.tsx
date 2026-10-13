import Link from '@/components/ui/link';
import { ChevronRight, History } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { SearchEmpty } from '@/components/shell/search-empty';
import { SearchField } from '@/components/shell/search-field';
import { Card } from '@/components/ui/card';
import { toggleChipClass } from '@/components/ui/chip';
import { EmptyState } from '@/components/ui/empty-state';
import { ModuleMark } from '@/components/ui/module-mark';
import {
  CHANGELOG_DEFAULT_GROUPING,
  CHANGELOG_GROUPINGS,
  CHANGELOG_GROUPING_LABEL,
  changelogModules,
  filterChangelog,
  filterChangelogByModule,
  groupChangelog,
  type ChangelogEntry,
  type ChangelogGroup,
  type ChangelogGrouping,
  type ChangelogModuleFilter,
} from '@/lib/changelog/entries';
import { cn } from '@/lib/cn';
import { ScreenAfters } from '@/components/dev/screen-change';
import type { ScreenChangeView } from '@/lib/plan/screen-change';
import { sourceProblems } from '@/lib/dev/post-check';
import { moduleById } from '@/lib/modules';
import { ViewChips } from '@/components/plan-tree/view-chips';
import { stepRef } from '@/lib/plan/ref';
import { PostAbout } from './post-about';

/**
 * The changelog apart from its read, so the surface gallery can draw it: the
 * grouping and workspace rows, the search, and what shipped under them.
 */
export function ChangelogView({
  entries,
  grouping,
  query,
  workspace,
  screens = {},
}: {
  entries: ChangelogEntry[];
  grouping: ChangelogGrouping;
  query: string;
  workspace: ChangelogModuleFilter | null;
  /** Each plan step's changed screens, by step number (plan #1541). Most steps have none. */
  screens?: Readonly<Record<number, readonly ScreenChangeView[]>>;
}) {
  // The options are built from everything that shipped, not from what is on
  // screen: a filter that removed every other workspace from the row would
  // leave no way back out of itself.
  const modules = changelogModules(entries);
  const matched = filterChangelog(filterChangelogByModule(entries, workspace), query);
  const groups = groupChangelog(matched, grouping);
  const workspaceViews: WorkspaceView[] = [ALL, ...modules];
  const workspaceLabels = Object.fromEntries(
    workspaceViews.map((candidate) => [candidate, workspaceLabel(candidate)]),
  ) as Record<WorkspaceView, string>;

  /**
   * A link for the grouping row and the workspace row, keeping everything else.
   *
   * A grouping link that dropped the search would throw away what you typed the
   * moment you asked to see it by day, and narrowing to the vault and then
   * regrouping is one thought rather than two. The search box keeps the other
   * two the same way, through `lib/list-search`.
   */
  function href(
    over: { group?: ChangelogGrouping; module?: ChangelogModuleFilter | null } = {},
  ): string {
    const nextGrouping = over.group ?? grouping;
    const nextModule = over.module === undefined ? workspace : over.module;

    const search = new URLSearchParams();
    if (nextGrouping !== CHANGELOG_DEFAULT_GROUPING) search.set('group', nextGrouping);
    if (nextModule) search.set('module', nextModule);
    if (query) search.set('q', query);
    const rest = search.toString();
    return rest ? `/dev/changelog?${rest}` : '/dev/changelog';
  }

  return (
    <div className="mx-auto max-w-3xl">
      {/* No paragraph under the heading: the rows say what they are, and a
          chevron on each says it opens (plan #1745). */}
      <PageHeader title="Changelog" />

      {entries.length > 0 && (
        <div className="mb-4 flex flex-col gap-2">
          <nav aria-label="Grouping" className="flex flex-wrap items-center gap-x-1 gap-y-2">
            {CHANGELOG_GROUPINGS.map((candidate) => (
              <Link
                key={candidate}
                href={href({ group: candidate })}
                aria-current={candidate === grouping ? 'page' : undefined}
                className={toggleChipClass(candidate === grouping)}
              >
                {CHANGELOG_GROUPING_LABEL[candidate]}
              </Link>
            ))}
          </nav>

          {/* Only worth a row when there is more than one thing to choose
              between: one workspace and an "Everything" beside it is two
              controls that do the same thing (law 15). One line at phone
              width: four chips fit, so past four the rest go under More
              (plan #1745). */}
          {modules.length > 1 && (
            <ViewChips<WorkspaceView>
              view={workspace ?? ALL}
              chips={workspaceViews.slice(0, workspaceViews.length > 4 ? 3 : 4)}
              menu={workspaceViews.length > 4 ? workspaceViews.slice(3) : []}
              labels={workspaceLabels}
              hrefOf={(candidate) => href({ module: candidate === ALL ? null : candidate })}
            />
          )}

          {/* Last in the block, so it sits directly above the list it narrows.
              The grouping and the workspace are already on the URL and the
              field carries them, so searching from inside a workspace stays
              inside it. */}
          <SearchField placeholder="Search what shipped" />
        </div>
      )}

      {groups.length === 0 && query ? (
        /* Clearing the search leaves the workspace and the grouping where they
           were: they are separate narrowings and undoing one should not undo
           the others. Widening back out to everything is the row of chips
           above. */
        <SearchEmpty query={query} />
      ) : groups.length === 0 ? (
        <EmptyState
          icon={History}
          title="Nothing has shipped yet"
          description="Close a plan step or fix a note and it appears here, under the day it landed."
          action={{ label: 'The plan', href: '/dev/plan' }}
        />
      ) : (
        /* One card holding every group, not a card per day: the changelog
         * only grows, so law 13 makes it a list, and a card per group was a
         * border and eight pixels of margin around every day of work. One
         * surface under the rows is the list pattern's (plan #1745). */
        <div className="space-y-3">
          <Card padding="dense" className="divide-y divide-border">
            {groups.map((group) => (
              <div key={group.key} className="py-1 first:pt-0 last:pb-0">
                {/* By issue, a feature is one line until it is asked to be
                    more. Its steps are the detail underneath. A group that is
                    its own heading -- a note, a feature that shipped by
                    itself -- has nothing to open and stays a plain line. */}
                {group.kind === 'issue' && !isItsOwnHeading(group) ? (
                  <IssueSummary group={group} screens={screens} />
                ) : (
                  <section>
                    {/* A group of one whose heading is its own entry gets no
                        heading: it would be the same sentence twice, which is
                        law 15. */}
                    {!isItsOwnHeading(group) && <GroupHeading group={group} />}
                    <ul className="divide-y divide-border">
                      {group.entries.map((entry) => (
                        <Entry
                          key={entry.key}
                          entry={entry}
                          inGroup={group.kind}
                          screens={screensOf(screens, entry)}
                        />
                      ))}
                    </ul>
                  </section>
                )}
              </div>
            ))}
          </Card>
          {/* The count closes the list, under the card, as on every list page. */}
          <p className="text-micro text-ink-ghost">
            {matched.length} {matched.length === 1 ? 'change' : 'changes'}
          </p>
        </div>
      )}
    </div>
  );
}

/** "Everything" in the workspace row: no workspace, rather than the app's own. */
const ALL = 'all';
type WorkspaceView = ChangelogModuleFilter | typeof ALL;

/**
 * A workspace chip's label. Short, so four fit on one line at phone width:
 * the app as a whole is "Whole app" here, and spelt out under an opened line.
 */
function workspaceLabel(candidate: WorkspaceView): string {
  if (candidate === ALL) return 'Everything';
  if (candidate === 'app') return 'Whole app';
  return moduleById(candidate)?.label ?? candidate;
}

/**
 * A group's heading, set for what it actually is.
 *
 * A day is a date, a commit is a sha and wants mono and its own break, and an
 * issue is the feature's title with its number -- so it is set like the plan
 * sets one, which is where the reader has seen it before.
 */
function isItsOwnHeading(group: ChangelogGroup): boolean {
  return (
    group.kind === 'issue' && group.entries.length === 1 && group.entries[0].issue === null
  );
}

/**
 * The feature's own closed row, and the steps that shipped under it.
 *
 * A feature and its steps are one group now, so the group holds up to two
 * kinds of row: the feature's own line, which carries nothing above it, and
 * the steps, which name it. The feature is the summary; only the steps go
 * underneath. Listing the feature's row again beneath its own title was the
 * page showing the top level and the underneath separately.
 */
function splitIssue(group: ChangelogGroup): { self: ChangelogEntry | null; steps: ChangelogEntry[] } {
  return {
    self: group.entries.find((entry) => entry.issue === null) ?? null,
    steps: group.entries.filter((entry) => entry.issue !== null),
  };
}

/**
 * A feature, as one line you can open.
 *
 * The page used to list every closed step at the top level, so a feature that
 * shipped as seven steps over three days was seven lines of "filing a todo from
 * it" and no line anywhere saying what had actually landed. The summary is the
 * feature's own title -- the sentence somebody was looking for -- with the
 * count and the day it finished; the steps are underneath, one click away.
 *
 * `details` rather than state, so the page still opens and reads with no
 * JavaScript at all, which is the rest of this page's bargain (law 5).
 */
function IssueSummary({
  group,
  screens,
}: {
  group: ChangelogGroup;
  screens: Readonly<Record<number, readonly ScreenChangeView[]>>;
}) {
  const newest = group.entries.reduce((at, entry) => (entry.at > at ? entry.at : at), '');
  const { self, steps } = splitIssue(group);
  // A feature whose lines all belong to one workspace carries its mark, the
  // same as each of those lines would; a feature across several leaves the
  // slot empty rather than picking one.
  const workspaces = new Set(group.entries.map((entry) => entry.module));
  const mark = workspaces.size === 1 ? [...workspaces][0] : undefined;

  return (
    <details className="group">
      <summary className={ROW}>
        <RowLead
          open="group-open:rotate-90"
          module={mark}
          name={group.number === null ? null : stepRef({ number: group.number })}
        />
        {/* The title has the line to itself on a phone, with the count and
            the day quietly underneath; from the small breakpoint up there is
            room for both on one line (plan #1745). */}
        <span className="flex min-w-0 flex-1 flex-col sm:flex-row sm:items-baseline sm:gap-3">
          <span className="line-clamp-2 break-words text-ui leading-6 font-medium text-ink sm:truncate">
            {group.label}
          </span>
          <span className="shrink-0 text-micro text-ink-ghost sm:ml-auto">
            {steps.length} {steps.length === 1 ? 'change' : 'changes'}
            {newest && ` · ${formatShortDay(newest.slice(0, 10))}`}
          </span>
        </span>
      </summary>
      <div className="mt-1 border-l-2 border-border pl-3">
        {/* What the feature itself said, and the commit that closed it. Its
            title is the line above, so the row is not drawn again -- only the
            part of it the summary had no room for. */}
        {self?.detail && <p className="row-pad text-small text-ink-muted">{self.detail}</p>}
        {self?.commitSha && (
          <p className="row-pad font-mono break-all text-micro text-ink-ghost">
            {self.commitSha}
          </p>
        )}
        <ul className="divide-y divide-border">
          {steps.map((entry) => (
            <Entry
              key={entry.key}
              entry={entry}
              inGroup={group.kind}
              screens={screensOf(screens, entry)}
            />
          ))}
        </ul>
      </div>
    </details>
  );
}

/**
 * Every row's summary, a feature's and a line's alike, so the two kinds sit on
 * one edge. The negative margin lets the hover reach past the text without
 * moving it.
 */
const ROW =
  'row-pad -mx-2 flex cursor-pointer list-none items-start gap-2 rounded-control px-2 hover:bg-sunken [&::-webkit-details-marker]:hidden';

/**
 * The slots in front of a row's title, the same three in the same order on
 * every row: the chevron, the workspace's mark and the number. A row without
 * a mark or a number keeps the space, so every title starts on one edge
 * (plan #1745). `module` undefined is no mark; null is the app's own.
 */
function RowLead({
  open,
  module,
  name,
}: {
  /** The rotate class for the `details` this row opens. */
  open: string;
  module: ChangelogEntry['module'] | undefined;
  /** The step as the plan page heads it, `#1073.4`; null for a note. */
  name: string | null;
}) {
  return (
    <>
      <span className="flex h-6 w-3.5 shrink-0 items-center" aria-hidden>
        <ChevronRight
          className={cn('size-3.5 text-ink-ghost transition-transform duration-quick', open)}
          strokeWidth={1.75}
        />
      </span>
      <span className="flex size-6 shrink-0 items-center">
        {module !== undefined && <ModuleMark module={module} size="sm" />}
      </span>
      <span className="tabular h-6 min-w-12 shrink-0 whitespace-nowrap text-small leading-6 text-ink-ghost">
        {name}
      </span>
    </>
  );
}

function GroupHeading({ group }: { group: ChangelogGroup }) {
  if (group.kind === 'commit') {
    return <h2 className="mb-1 font-mono break-all text-small text-ink-muted">{group.label}</h2>;
  }

  if (group.kind === 'day') {
    return <h2 className="mb-1 text-small font-medium text-ink-muted">{formatDay(group.label)}</h2>;
  }

  return (
    <h2 className="mb-1 flex items-baseline gap-1.5 text-small font-medium text-ink">
      {group.number !== null && (
        <span className="tabular shrink-0 text-ink-ghost">#{group.number}</span>
      )}
      <span className="min-w-0 break-words">{group.label}</span>
    </h2>
  );
}

/**
 * One thing that shipped.
 *
 * The mark says which workspace it belonged to without costing a word, which
 * is what it is for — but it is decoration to a screen reader, so the
 * workspace is also named in the line that links back, where it reads as part
 * of a sentence rather than as a label nobody asked for.
 */
function Entry({
  entry,
  inGroup,
  screens,
}: {
  entry: ChangelogEntry;
  /** What the heading above already said, so the line does not repeat it. */
  inGroup: ChangelogGroup['kind'];
  /** The screens this step changed, drawn under the line as they look now. */
  screens: readonly ScreenChangeView[];
}) {
  const workspace = moduleById(entry.module)?.label ?? 'The app as a whole';

  return (
    <li>
      <details className="group/entry">
        <summary className={ROW}>
          <RowLead
            open="group-open/entry:rotate-90"
            module={entry.module}
            name={entry.number === null ? null : stepRef({ number: entry.number, outline: entry.outline })}
          />
          {/* Two lines at most on a phone and one from the small breakpoint
              up. A note's title is the whole thing somebody typed on a phone,
              so the untruncated version is three lines and the list stops
              being scannable. What was cut is one click away. */}
          <span className="line-clamp-2 min-w-0 flex-1 break-words text-ui leading-6 text-ink sm:truncate">
            {entry.title}
          </span>
        </summary>

        <div className="row-pad flex flex-col gap-1 pt-0 pr-2 pl-[1.875rem]">
          {/* The title again, whole. The line above is cut to keep the list one
              row per thing, and the first job of opening a row is to read the
              part that did not fit. */}
          <p className="break-words text-ui text-ink">{entry.title}</p>
          {entry.detail && <p className="text-small text-ink-muted">{entry.detail}</p>}
          <p className="flex flex-wrap items-baseline gap-x-2 text-micro text-ink-ghost">
            {/* The plan opens on the open steps, so a link to a step that is done
                has to ask for the view that shows it. Neither page can be linked
                any deeper than itself: a step is opened by a click rather than by
                a URL, and a note has no anchor of its own either. */}
            <Link
              href={entry.source === 'plan' ? '/dev/plan?view=all' : '/dev/bugs'}
              className="press-area transition-colors duration-quick hover:text-accent"
            >
              {entry.source === 'plan' ? `${workspace} · plan` : `${workspace} · note`}
            </Link>
            {/* Whole, and in mono, which is how the plan page shows one. A
                changelog is where somebody goes to find the commit, and a
                shortened sha is one more step before they can paste it. */}
            {/* Not under a commit heading: the sha is already the heading, and
                printing it again on every line under it is furniture (law 15). */}
            {entry.commitSha && inGroup !== 'commit' && (
              <span className="font-mono break-all">{entry.commitSha}</span>
            )}
          </p>
          {postable(entry) && entry.number !== null && <PostAbout number={entry.number} />}
        </div>
      </details>
      {/* Outside the fold, so a line that changed a screen shows the screen
          without being opened: the picture is what you came to see (plan
          #1541). Only the after; the before is on the step's plan row. */}
      {screens.length > 0 && (
        <div className="pb-2 pl-[1.875rem]">
          <ScreenAfters changes={screens} />
        </div>
      )}
    </li>
  );
}

/** A plan line's changed screens; a note's line has none. */
function screensOf(
  screens: Readonly<Record<number, readonly ScreenChangeView[]>>,
  entry: ChangelogEntry,
): readonly ScreenChangeView[] {
  if (entry.source !== 'plan' || entry.number === null) return [];
  return screens[entry.number] ?? [];
}

/**
 * Whether a line can be posted about (plan #1420): a plan step in Dev or the
 * app as a whole whose title and detail pass the posts source check. Any other
 * line goes without the button rather than offering one that would only
 * refuse. The action reads the step again, close note included.
 */
function postable(entry: ChangelogEntry): boolean {
  if (entry.source !== 'plan' || entry.number === null) return false;
  return (
    sourceProblems({
      label: stepRef({ number: entry.number, outline: entry.outline }),
      module: entry.module,
      text: [entry.title, entry.detail].filter(Boolean).join('\n'),
    }).length === 0
  );
}

/**
 * The day heading.
 *
 * UTC, because the day key is the UTC date of the instant the row closed — see
 * `lib/changelog/entries.ts`. Formatting it in another zone would print a
 * heading that disagreed with the grouping under it.
 */
function formatDay(day: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${day}T00:00:00Z`));
}

/** "4 Oct" for a summary line, with the year only when it is not this one. */
function formatShortDay(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  const thisYear = date.getUTCFullYear() === new Date().getUTCFullYear();
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: thisYear ? undefined : 'numeric',
    timeZone: 'UTC',
  }).format(date);
}
