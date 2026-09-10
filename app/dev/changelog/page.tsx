import Link from 'next/link';
import { ChevronRight, History, SearchX } from 'lucide-react';
import { createClient, requireUser } from '@/lib/auth/server';
import { PageHeader } from '@/components/shell/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/field';
import { ModuleMark } from '@/components/ui/module-mark';
import { loadChangelog } from '@/lib/changelog/load';
import {
  CHANGELOG_DEFAULT_GROUPING,
  CHANGELOG_GROUPINGS,
  CHANGELOG_GROUPING_LABEL,
  filterChangelog,
  groupChangelog,
  isChangelogGrouping,
  type ChangelogEntry,
  type ChangelogGroup,
  type ChangelogGrouping,
} from '@/lib/changelog/entries';
import { cn } from '@/lib/cn';
import { moduleById } from '@/lib/modules';

export const metadata = { title: 'Changelog' };

/**
 * What has already shipped.
 *
 * The other three lists in this workspace all say what is going to happen — a
 * bug is a thing that is wrong now, the plan is what was decided on, an idea is
 * what nobody has committed to. Nothing said what already did, so the only way
 * to answer "when did that land, and in which commit" was to read the git log
 * beside the plan page and join the two by eye.
 *
 * Every line is one of the app's own closed rows: a plan step marked done or a
 * note marked fixed, both of which already carry the commit that shipped them
 * and the day they closed. That is the answer recorded on plan step #122, and
 * its cost is worth knowing before wondering where something is: work done off
 * the plan and outside the notes queue — a refactor, a UI sweep — never appears
 * here, because nothing in the app ever knew about it.
 *
 * No filter by module in v1. The list is short enough to read straight through,
 * and a control that narrows a page most people will scroll to the bottom of is
 * a control nobody presses.
 *
 * It is grouped three ways. By issue is what it opens on: a feature's steps
 * gathered under the feature, one line each, because six lines spread over
 * three days were one piece of work and the page had no way of saying so. By
 * day is the flat record, and by commit puts back together what one commit
 * closed, which a batch scatters. The grouping is a search parameter and not
 * state, so "the changelog by commit" is a link somebody can keep -- law 5, and
 * it means this page still works with no JavaScript at all.
 */
export default async function DevChangelogPage({
  searchParams,
}: {
  searchParams: Promise<{ group?: string | string[]; q?: string | string[] }>;
}) {
  const user = await requireUser();
  const supabase = await createClient();
  const params = await searchParams;

  const asked = Array.isArray(params.group) ? params.group[0] : params.group;
  const grouping: ChangelogGrouping =
    asked && isChangelogGrouping(asked) ? asked : CHANGELOG_DEFAULT_GROUPING;

  const query = (Array.isArray(params.q) ? params.q[0] : params.q)?.trim() ?? '';

  const entries = await loadChangelog(supabase, user.id);
  const matched = filterChangelog(entries, query);
  const groups = groupChangelog(matched, grouping);

  /**
   * Both parameters travel together.
   *
   * A grouping link that dropped the search would throw away what you typed the
   * moment you asked to see it by day, and the form has to carry the grouping
   * for the same reason in reverse.
   */
  function href(candidate: ChangelogGrouping): string {
    const search = new URLSearchParams();
    if (candidate !== CHANGELOG_DEFAULT_GROUPING) search.set('group', candidate);
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
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <nav aria-label="Grouping" className="flex flex-wrap items-center gap-1">
            {CHANGELOG_GROUPINGS.map((candidate) => (
              <Link
                key={candidate}
                href={href(candidate)}
                aria-current={candidate === grouping ? 'page' : undefined}
                className={cn(
                  'press rounded-full px-2.5 py-1 text-small font-medium transition-colors',
                  candidate === grouping
                    ? 'bg-accent text-surface'
                    : 'text-ink-muted hover:bg-accent-tint hover:text-accent',
                )}
              >
                {CHANGELOG_GROUPING_LABEL[candidate]}
              </Link>
            ))}
          </nav>

          {/* A plain GET form, like the rest of this page: the search is in the
              URL, so a search is a link somebody can keep and the page still
              works with no JavaScript at all (law 5). */}
          <form action="/dev/changelog" className="ml-auto flex items-center gap-2">
            {grouping !== CHANGELOG_DEFAULT_GROUPING && (
              <input type="hidden" name="group" value={grouping} />
            )}
            <Input
              type="search"
              name="q"
              defaultValue={query}
              placeholder="Search what shipped"
              aria-label="Search what shipped"
              className="w-48"
            />
          </form>
        </div>
      )}

      {groups.length === 0 && query ? (
        <EmptyState
          icon={SearchX}
          title={`Nothing shipped matching “${query}”`}
          description="Searches the title, what was written about it, the commit, and the feature it shipped under."
          action={{ label: 'Clear the search', href: href(grouping) }}
        />
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
              <IssueSummary key={group.key} group={group} />
            ) : (
              <section key={group.key}>
                {/* A group of one whose heading is its own entry -- a note, or a
                    feature that shipped by itself -- gets no heading: it would
                    be the same sentence twice, which is law 15. */}
                {!isItsOwnHeading(group) && <GroupHeading group={group} />}
                <ul className="divide-y divide-border">
                  {group.entries.map((entry) => (
                    <Entry key={entry.key} entry={entry} inGroup={group.kind} />
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
 * A group's heading, set for what it actually is.
 *
 * A day is a date, a commit is a sha and wants mono and its own break, and an
 * issue is the feature's title with its number -- so it is set like the plan
 * sets one, which is where the reader has seen it before.
 */
function isItsOwnHeading(group: ChangelogGroup): boolean {
  return group.kind === 'issue' && group.entries.length === 1 && group.entries[0].key === group.key;
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
function IssueSummary({ group }: { group: ChangelogGroup }) {
  const newest = group.entries.reduce((at, entry) => (entry.at > at ? entry.at : at), '');

  return (
    <details className="group">
      <summary className="row-pad -mx-2 flex cursor-pointer list-none items-baseline gap-1.5 rounded-lg px-2 hover:bg-sunken [&::-webkit-details-marker]:hidden">
        <ChevronRight
          className="size-3.5 shrink-0 self-center text-ink-ghost transition-transform duration-150 group-open:rotate-90"
          strokeWidth={1.75}
          aria-hidden
        />
        {group.number !== null && (
          <span className="tabular shrink-0 text-small text-ink-ghost">#{group.number}</span>
        )}
        <span className="min-w-0 flex-1 break-words text-ui font-medium text-ink">
          {group.label}
        </span>
        <span className="shrink-0 text-micro text-ink-ghost">
          {group.entries.length} {group.entries.length === 1 ? 'change' : 'changes'}
          {newest && ` · ${formatDay(newest.slice(0, 10))}`}
        </span>
      </summary>
      <ul className="mt-1 divide-y divide-border border-l-2 border-border pl-3">
        {group.entries.map((entry) => (
          <Entry key={entry.key} entry={entry} inGroup={group.kind} />
        ))}
      </ul>
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
}: {
  entry: ChangelogEntry;
  /** What the heading above already said, so the line does not repeat it. */
  inGroup: ChangelogGroup['kind'];
}) {
  const workspace = moduleById(entry.module)?.label ?? 'The app as a whole';

  return (
    <li className="row-pad flex gap-3">
      <ModuleMark module={entry.module} size="sm" className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-baseline gap-1.5 text-ui text-ink">
          {entry.number !== null && (
            <span className="tabular shrink-0 text-small text-ink-ghost">#{entry.number}</span>
          )}
          <span className="min-w-0 break-words">{entry.title}</span>
        </p>
        {entry.detail && <p className="mt-0.5 text-small text-ink-muted">{entry.detail}</p>}
        <p className="mt-1 flex flex-wrap items-baseline gap-x-2 text-micro text-ink-ghost">
          {/* The plan opens on the open steps, so a link to a step that is done
              has to ask for the view that shows it. Neither page can be linked
              any deeper than itself: a step is opened by a click rather than by
              a URL, and a note has no anchor of its own either. */}
          <Link
            href={entry.source === 'plan' ? '/dev/plan?view=all' : '/dev/bugs'}
            className="transition-colors duration-150 hover:text-accent"
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
      </div>
    </li>
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
