import Link from 'next/link';
import { History } from 'lucide-react';
import { createClient, requireUser } from '@/lib/auth/server';
import { PageHeader } from '@/components/shell/page-header';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ModuleMark } from '@/components/ui/module-mark';
import { loadChangelog } from '@/lib/changelog/load';
import type { ChangelogEntry } from '@/lib/changelog/entries';
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
 */
export default async function DevChangelogPage() {
  const user = await requireUser();
  const supabase = await createClient();
  const days = await loadChangelog(supabase, user.id);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Changelog"
        description="What has shipped, newest first — every plan step closed and every note fixed, with the commit that did it."
      />

      {days.length === 0 ? (
        <EmptyState
          icon={History}
          title="Nothing has shipped yet"
          description="Close a plan step or fix a note and it appears here, under the day it landed."
          action={{ label: 'The plan', href: '/dev/plan' }}
        />
      ) : (
        <div className="space-y-4">
          {days.map((day) => (
            <Card key={day.day} padding="dense">
              <h2 className="mb-1 text-small font-medium text-ink-muted">{formatDay(day.day)}</h2>
              <ul className="divide-y divide-border">
                {day.entries.map((entry) => (
                  <Entry key={entry.key} entry={entry} />
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </div>
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
function Entry({ entry }: { entry: ChangelogEntry }) {
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
          {entry.commitSha && <span className="font-mono break-all">{entry.commitSha}</span>}
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
