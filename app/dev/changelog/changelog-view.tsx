import Link from 'next/link';
import { ChevronRight, History } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { SearchEmpty } from '@/components/shell/search-empty';
import { SearchField } from '@/components/shell/search-field';
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
      <PageHeader
        title="Changelog"
        description="What has shipped, newest first — a line per feature. Open one for the steps and notes underneath it, and the commit that did each."
      />

      {entries.length > 0 && (
        <div className="mb-4 flex flex-col gap-2">
          <nav aria-label="Grouping" className="flex flex-wrap items-center gap-x-1 gap-y-2">
            {CHANGELOG_GROUPINGS.map((candidate) => (
              <Link
                key={candidate}
                href={href({ group: candidate })}
                aria-current={candidate === grouping ? 'page' : undefined}
                className={cn(
                  'press press-area rounded-full px-2.5 py-1 text-small font-medium transition-colors',
                  candidate === grouping
                    ? 'bg-accent text-surface'
                    : 'text-ink-muted hover:bg-accent-tint hover:text-accent',
                )}
              >
                {CHANGELOG_GROUPING_LABEL[candidate]}
              </Link>
            ))}
          </nav>

          {/* Only worth a row when there is more than one thing to choose
              between: one workspace and an "Everything" beside it is two
              controls that do the same thing (law 15). */}
          {modules.length > 1 && (
            <nav aria-label="Workspace" className="flex flex-wrap items-center gap-x-1 gap-y-2">
              <ModuleFilter href={href({ module: null })} current={workspace === null} label="Everything" />
              {modules.map((candidate) => (
                <ModuleFilter
                  key={candidate}
                  href={href({ module: candidate })}
                  current={candidate === workspace}
                  module={candidate}
                  label={
                    candidate === 'app'
                      ? 'The app as a whole'
                      : (moduleById(candidate)?.label ?? candidate)
                  }
                />
              ))}
            </nav>
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
        /* A heading and its entries, not a card per day. The changelog is
         * scrolled by definition -- it only grows -- so law 13 makes it a
         * list, and a card per group was a border and eight pixels of margin
         * around every day of work. */
        <div className="space-y-5">
          {groups.map((group) =>
            /* By issue, a feature is one line until it is asked to be more.
               Its steps are the detail underneath. A group that is its own
               heading -- a note, a feature that shipped by itself -- has
               nothing to open and stays a plain line. */
            group.kind === 'issue' && !isItsOwnHeading(group) ? (
              <IssueSummary key={group.key} group={group} screens={screens} />
            ) : (
              <section key={group.key}>
                {/* A group of one whose heading is its own entry -- a note, or a
                    feature that shipped by itself -- gets no heading: it would
                    be the same sentence twice, which is law 15. */}
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
            ),
          )}
        </div>
      )}
    </div>
  );
}

/**
 * One workspace to narrow to.
 *
 * The same chip as the grouping row above it, carrying the workspace's mark —
 * the mark is how the lines underneath are already labelled, so the chip and
 * the rows it leaves on screen say the same thing the same way. It is
 * decoration to a screen reader, which reads the label beside it.
 */
function ModuleFilter({
  href,
  current,
  module,
  label,
}: {
  href: string;
  current: boolean;
  /** Absent on "Everything", which is no workspace rather than the app's own. */
  module?: ChangelogModuleFilter;
  label: string;
}) {
  return (
    <Link
      href={href}
      aria-current={current ? 'page' : undefined}
      className={cn(
        'press press-area flex items-center gap-1.5 rounded-full px-2.5 py-1 text-small font-medium transition-colors',
        current
          ? 'bg-accent text-surface'
          : 'text-ink-muted hover:bg-accent-tint hover:text-accent',
      )}
    >
      {module && (
        <ModuleMark module={module === 'app' ? null : module} size="sm" className="shrink-0" />
      )}
      {label}
    </Link>
  );
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

  return (
    <details className="group">
      <summary className="row-pad -mx-2 flex cursor-pointer list-none items-baseline gap-1.5 rounded-lg px-2 hover:bg-sunken [&::-webkit-details-marker]:hidden">
        <ChevronRight
          className="size-3.5 shrink-0 self-center text-ink-ghost transition-transform duration-quick group-open:rotate-90"
          strokeWidth={1.75}
          aria-hidden
        />
        {group.number !== null && (
          <span className="tabular shrink-0 text-small text-ink-ghost">#{group.number}</span>
        )}
        {/* One line, like every row under it. */}
        <span className="min-w-0 flex-1 truncate text-ui font-medium text-ink">{group.label}</span>
        <span className="shrink-0 text-micro text-ink-ghost">
          {steps.length} {steps.length === 1 ? 'change' : 'changes'}
          {newest && ` · ${formatDay(newest.slice(0, 10))}`}
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
        <summary className="row-pad flex cursor-pointer list-none items-baseline gap-3 hover:bg-sunken [&::-webkit-details-marker]:hidden">
          <ChevronRight
            className="size-3 shrink-0 self-center text-ink-ghost transition-transform duration-quick group-open/entry:rotate-90"
            strokeWidth={1.75}
            aria-hidden
          />
          <ModuleMark module={entry.module} size="sm" className="shrink-0 self-center" />
          {entry.number !== null && (
            <span className="tabular shrink-0 text-small text-ink-ghost">#{entry.number}</span>
          )}
          {/* One line, truncated. A note's title is the whole thing somebody
              typed on a phone, so the untruncated version is three lines and
              the list stops being scannable. What was cut is one click away. */}
          <span className="min-w-0 flex-1 truncate text-ui text-ink">{entry.title}</span>
        </summary>

        <div className="row-pad flex flex-col gap-1 pt-0 pl-9">
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
        <div className="pb-2 pl-9">
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
      label: `#${entry.number}`,
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
