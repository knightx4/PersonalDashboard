import { KanbanSquare } from 'lucide-react';
import { countConnectedInboxes } from '@/lib/core/inbox/accounts';
import { createClient, requireUser } from '@/lib/jobs/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import Link from 'next/link';
import { PipelineBoard, STALE_DAYS } from '@/components/jobs/pipeline/board';
import { LeftRail, RailGroup, RailItem } from '@/components/jobs/shell/left-rail';
import { PageHeader } from '@/components/jobs/shell/page-header';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { loadPipeline, type PipelineRow } from '@/lib/jobs/applications/load';
import { APPLICATION_SOURCES, SOURCE_LABELS, type ApplicationSource } from '@/lib/jobs/pipeline';

export const metadata = { title: 'Pipeline' };



function hrefFor(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  const query = search.toString();
  return query ? `/jobs/pipeline?${query}` : '/jobs/pipeline';
}

function isStale(row: PipelineRow): boolean {
  return (row.daysSinceActivity ?? 0) > STALE_DAYS;
}

export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<{ source?: string; excitement?: string; stale?: string; company?: string }>;
}) {
  const user = await requireUser();
  const supabase = await createClient();
  const core = await createCoreClient();
  const params = await searchParams;

  const [rows, inboxCount] = await Promise.all([
    loadPipeline(supabase, user.id),
    countConnectedInboxes(core, user.id),
  ]);

  const source = APPLICATION_SOURCES.find((s) => s === params.source);
  const excitement = params.excitement ? Number(params.excitement) : null;
  const staleOnly = params.stale === '1';

  let filtered = rows;
  if (source) filtered = filtered.filter((row) => row.source === source);
  if (excitement) filtered = filtered.filter((row) => (row.excitement ?? 0) >= excitement);
  if (staleOnly) filtered = filtered.filter(isStale);

  const countsBySource = new Map<ApplicationSource, number>();
  for (const row of rows) {
    countsBySource.set(row.source, (countsBySource.get(row.source) ?? 0) + 1);
  }

  if (rows.length === 0) {
    return (
      <>
        <PageHeader
          title="Pipeline"
          description="Where every pursuit stands, and what needs attention today."
        />
        <EmptyState
          icon={KanbanSquare}
          title="Nothing in the pipeline yet"
          description={
            (inboxCount ?? 0) > 0
              ? 'Add a role by pasting a job link, or wait for the next inbox scan to find your confirmations.'
              : 'Add a role by pasting a job link, or capture one with the bookmarklet.'
          }
          action={{ label: 'Add a role', href: '/jobs/roles/new' }}
          secondaryAction={
            (inboxCount ?? 0) > 0
              ? { label: 'Inbox settings', href: '/jobs/settings' }
              : { label: 'Settings', href: '/jobs/settings' }
          }
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Pipeline"
        description={`${rows.length} ${rows.length === 1 ? 'pursuit' : 'pursuits'}, ${rows.filter(isStale).length} gone quiet.`}
        actions={
          <Link href="/jobs/roles/new" className={buttonVariants({ size: 'sm' })}>
            Add a role
          </Link>
        }
      />

      <div className="flex gap-6">
        <LeftRail>
          <RailGroup label="Source">
            <RailItem
              label="All sources"
              href={hrefFor({ excitement: params.excitement, stale: params.stale })}
              active={!source}
              count={rows.length}
            />
            {APPLICATION_SOURCES.filter((s) => countsBySource.has(s)).map((entry) => (
              <RailItem
                key={entry}
                label={SOURCE_LABELS[entry]}
                href={hrefFor({
                  source: entry,
                  excitement: params.excitement,
                  stale: params.stale,
                })}
                active={source === entry}
                count={countsBySource.get(entry)}
              />
            ))}
          </RailGroup>

          <RailGroup label="Excitement">
            <RailItem
              label="Any"
              href={hrefFor({ source: params.source, stale: params.stale })}
              active={!excitement}
            />
            {[5, 4, 3].map((level) => (
              <RailItem
                key={level}
                label={`${'★'.repeat(level)} and up`}
                href={hrefFor({
                  source: params.source,
                  excitement: String(level),
                  stale: params.stale,
                })}
                active={excitement === level}
              />
            ))}
          </RailGroup>

          <RailGroup label="Attention">
            <RailItem
              label={`Quiet ${STALE_DAYS}+ days`}
              href={hrefFor({
                source: params.source,
                excitement: params.excitement,
                stale: staleOnly ? undefined : '1',
              })}
              active={staleOnly}
              count={rows.filter(isStale).length}
            />
          </RailGroup>

          <p className="px-1 text-[11px] leading-relaxed text-ink-faint">
            Priority lives on the company, not the pursuit —{' '}
            <Link href="/jobs/companies" className="underline underline-offset-2">
              set it there
            </Link>
            .
          </p>
        </LeftRail>

        <div className="min-w-0 flex-1">
          <PipelineBoard rows={filtered} />
        </div>
      </div>
    </>
  );
}
