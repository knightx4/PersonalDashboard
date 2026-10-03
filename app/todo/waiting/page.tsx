import { Hourglass } from 'lucide-react';
import { requireUser } from '@/lib/auth/server';
import { loadWaiting } from '@/lib/todo/waiting/load';
import { sinceLabel } from '@/lib/todo/waiting/model';
import { PageHeader } from '@/components/shell/page-header';
import { Banner } from '@/components/ui/banner';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ModuleMark } from '@/components/ui/module-mark';

export const metadata = { title: 'Waiting' };

/**
 * What you are waiting on, by who has it (plan #1475; docs/CORE-AND-DASH-SPEC.md,
 * Part 4). The Agenda is what is on you; this is the other half, read live
 * from the workspaces that own each row. An application you sent sits here
 * under the company, and when they write back it leaves for the Agenda.
 *
 * No buttons: there is nothing to do about a thing someone else has, and
 * each row links to where it lives for when there is.
 */
export default async function WaitingPage() {
  const user = await requireUser();
  const waiting = await loadWaiting(user.id);
  const count = waiting.groups.reduce((sum, group) => sum + group.entries.length, 0);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Waiting"
        description={
          count === 0 ? 'Nothing is waiting on anyone else.' : 'What someone else has to move next, by who.'
        }
      />

      {waiting.failed.length > 0 && (
        <Banner tone="bad" className="mt-4">
          {waiting.failed.join(' and ')} could not be read just now, so anything from{' '}
          {waiting.failed.length > 1 ? 'them' : 'it'} is missing from this page.
        </Banner>
      )}

      {count === 0 ? (
        <EmptyState
          icon={Hourglass}
          title="Nothing waiting."
          description="An application you send or an order on its way shows here until it is yours to move."
          className="mt-6"
        />
      ) : (
        <div className="mt-6 space-y-6">
          {waiting.groups.map((group) => (
            <section key={group.key}>
              <h2 className="text-ui font-semibold text-ink">
                {group.name}
                <span className="tabular ml-2 text-small font-normal text-ink-muted">
                  {group.entries.length}
                </span>
              </h2>
              <Card padding="none" className="mt-1 divide-y divide-border px-3">
                {group.entries.map((entry) => {
                  const since = sinceLabel(entry.since, waiting.timezone);
                  return (
                    <div key={entry.key} className="row-pad flex items-start gap-3" title={entry.why}>
                      <span className="mt-0.5 self-start">
                        <ModuleMark module={entry.module} size="xs" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                          {entry.link ? (
                            <a
                              href={entry.link.href}
                              className="text-ui font-medium text-ink transition-colors duration-150 hover:text-accent"
                            >
                              {entry.title}
                            </a>
                          ) : (
                            <span className="text-ui font-medium text-ink">{entry.title}</span>
                          )}
                          {entry.detail && (
                            <span className="text-small text-ink-muted">{entry.detail}</span>
                          )}
                        </div>
                        <p className="text-small text-ink-muted">{entry.why}</p>
                      </div>
                      {since && (
                        <span className="tabular shrink-0 text-small text-ink-muted">{since}</span>
                      )}
                    </div>
                  );
                })}
              </Card>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
