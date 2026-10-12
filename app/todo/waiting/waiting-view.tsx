import { Hourglass } from 'lucide-react';
import type { Waiting } from '@/lib/todo/waiting/load';
import { sinceLabel } from '@/lib/todo/waiting/model';
import { PageHeader } from '@/components/shell/page-header';
import { Banner } from '@/components/ui/banner';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ModuleMark } from '@/components/ui/module-mark';

/**
 * Waiting, drawn from what the page read (page.tsx), so the gallery can draw
 * it from fixtures (plan #1603).
 */
export function WaitingView({ waiting }: { waiting: Waiting }) {
  const count = waiting.groups.reduce((sum, group) => sum + group.entries.length, 0);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Waiting" />

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
          description="Nothing is waiting on anyone else. An application you send or an order on its way shows here until it is yours to move."
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
                    <div key={entry.key} className="row-pad" title={entry.why}>
                      <div className="flex items-start gap-3">
                        <span className="mt-0.5 self-start">
                          <ModuleMark module={entry.module} size="xs" />
                        </span>
                        {entry.link ? (
                          <a
                            href={entry.link.href}
                            className="press-area line-clamp-2 min-w-0 flex-1 text-ui font-medium text-ink transition-colors duration-quick [overflow-wrap:anywhere] hover:text-accent"
                          >
                            {entry.title}
                          </a>
                        ) : (
                          <span className="line-clamp-2 min-w-0 flex-1 text-ui font-medium text-ink [overflow-wrap:anywhere]">
                            {entry.title}
                          </span>
                        )}
                        {since && (
                          <span className="tabular shrink-0 text-small text-ink-muted">{since}</span>
                        )}
                      </div>
                      <p className="truncate text-small text-ink-muted">
                        {entry.detail ? `${entry.detail} · ${entry.why}` : entry.why}
                      </p>
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
