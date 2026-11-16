import Link from '@/components/ui/link';
import { BookOpen } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { PageColumn } from '@/components/shell/page-width';
import { buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { LiveDot } from '@/components/ui/live-dot';
import { sectionSubject } from '@/lib/core/section-path';
import { minutesLeft, nextSection, type ReaderRow, type Shelves } from '@/lib/learn/reader/shelves';
import { AskBox, FindMore } from './ask';

/**
 * Learn's front page (docs/LEARN-READER-SPEC.md). It opens on what there is
 * to read, already prepared, so nothing waits on a model. One button picks up
 * the thing you were reading at the section you stopped on. Under it, one
 * surface of rows in four groups: what you started, what was chosen against
 * your notes, what is new to you, and what you asked for. Then the box that
 * takes a topic, a link or a pasted text, and the ideas you have met so far.
 */
export function ReadView({ shelves }: { shelves: Shelves }) {
  const first =
    shelves.continuing[0] ?? shelves.asked[0] ?? shelves.near[0] ?? shelves.fresh[0] ?? null;
  const groups: { label: string; rows: ReaderRow[] }[] = [
    { label: 'Continue', rows: shelves.continuing },
    { label: 'You asked for', rows: shelves.asked },
    { label: 'Near your notes', rows: shelves.near },
    { label: 'New', rows: shelves.fresh },
    { label: 'Being prepared', rows: shelves.coming },
  ].filter((group) => group.rows.length > 0);
  const unread = shelves.near.length + shelves.fresh.length;

  return (
    <PageColumn className="space-y-6">
      <PageHeader subject={sectionSubject('/learn/read', 'Read')} title="Read" />

      {first && <PickUp row={first} />}

      {groups.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title="Nothing to read yet"
          description="Type a topic, paste a link or paste a text below, and Dash prepares it: the context, the argument in brief, then the text itself with notes on the hard parts."
        />
      ) : (
        <Card padding="none" className="divide-y divide-border">
          {groups.map((group) => (
            <section key={group.label} aria-label={group.label}>
              <h2 className="card-pad-x bg-sunken py-1.5 text-small font-medium text-ink-muted">
                {group.label}
              </h2>
              <ul className="divide-y divide-border">
                {group.rows.map((row) => (
                  <li key={row.id}>
                    <Link
                      href={`/learn/read/${row.id}`}
                      className="card-pad-x row-pad flex min-h-11 items-center gap-3 transition-colors duration-quick hover:bg-sunken"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-ui font-medium text-ink [overflow-wrap:anywhere]">
                          {row.title}
                        </span>
                        <span className="block text-small text-ink-muted [overflow-wrap:anywhere]">
                          {rowLine(row)}
                        </span>
                        {row.why && row.read.length === 0 && (
                          <span className="block text-small text-ink-muted [overflow-wrap:anywhere]">
                            {row.why}
                          </span>
                        )}
                      </span>
                      {!row.outline && row.status !== 'failed' && (
                        <LiveDot
                          tone={row.status === 'preparing' ? 'accent' : 'muted'}
                          still={row.status !== 'preparing'}
                        />
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </Card>
      )}

      <AskBox />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {shelves.ideas.length > 0 && (
          <Link href="/learn/read/ideas" className={buttonVariants({ variant: 'secondary' })}>
            Ideas you have met · {shelves.ideas.length}
          </Link>
        )}
        <FindMore finding={shelves.finding} unread={unread} />
      </div>
    </PageColumn>
  );
}

/** The one press that gets you reading: the next section of the thing at the top. */
function PickUp({ row }: { row: ReaderRow }) {
  const next = nextSection(row);
  const section = next ? row.outline?.sections[next - 1] : null;
  if (!next || !section) return null;
  const started = row.read.length > 0;
  return (
    <Link
      href={started ? `/learn/read/${row.id}/${next}` : `/learn/read/${row.id}`}
      className={buttonVariants({
        variant: 'primary',
        size: 'lg',
        className: 'h-auto w-full flex-col items-start gap-0.5 py-3 text-left whitespace-normal',
      })}
    >
      <span className="max-w-full text-body font-medium whitespace-normal">
        {started ? 'Pick up where you left off' : `Start ${row.title}`}
      </span>
      <span className="max-w-full text-small whitespace-normal opacity-80 [overflow-wrap:anywhere]">
        {started
          ? `${row.title} · ${section.title} · ${section.minutes} min`
          : `${row.outline?.sections.length} sections · ${row.outline?.minutes} min in all`}
      </span>
    </Link>
  );
}

function rowLine(row: ReaderRow): string {
  if (!row.outline) {
    if (row.status === 'failed') return 'Dash could not prepare this. Open it to try again.';
    return row.status === 'preparing' ? 'Dash is preparing this' : 'Waiting for Dash to start';
  }
  const total = row.outline.sections.length;
  const by = [row.author, row.outline.published].filter(Boolean).join(' · ');
  const next = nextSection(row);
  if (row.read.length > 0 && next)
    return `${by} · section ${next} of ${total} · ${minutesLeft(row)} min left`;
  return `${by} · ${total} sections · ${row.outline.minutes} min`;
}
