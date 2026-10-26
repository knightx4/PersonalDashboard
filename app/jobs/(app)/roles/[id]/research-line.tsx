'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { DashAction } from '@/components/ui/dash-action';
import { FieldError } from '@/components/ui/field';
import { linkVariants } from '@/components/ui/link';
import { formatDate } from '@/lib/jobs/applications/load';
import type { ResearchStatus } from '@/lib/jobs/companies/research';
import { startCompanyResearch } from '../../companies/actions';

/** What the role page knows about the company's research, for the Application tab. */
export type RoleResearch = {
  companyId: string;
  companySlug: string;
  /** The newest run's state, whatever it is; null when none was ever asked for. */
  latestStatus: ResearchStatus | null;
  /** When the newest finished write-up was done; null when there is none. */
  readyAt: string | null;
  /** Whether the deployment can start the research routine. */
  available: boolean;
};

/**
 * Whether the full company research routine has been run on this role's
 * company, with its button, so an application can be written knowing that
 * without going to the company's Perspective tab (note 6b260c08). The
 * write-up itself stays on that tab, and this links to it.
 */
export function ResearchLine({
  research,
  companyName,
  timezone,
}: {
  research: RoleResearch;
  companyName: string;
  timezone: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const running = research.latestStatus === 'queued' || research.latestStatus === 'researching';
  const href = `/jobs/companies/${research.companySlug}?tab=perspective`;

  const start = () =>
    startTransition(async () => {
      const result = await startCompanyResearch(research.companyId);
      setError(result.error);
      if (!result.error) router.refresh();
    });

  const line = running
    ? `Dash is researching ${companyName} now.`
    : research.readyAt
      ? `Company research done ${formatDate(research.readyAt, timezone)}.`
      : research.latestStatus === 'failed'
        ? 'The last company research run did not finish.'
        : 'No company research yet.';

  return (
    <Card padding="dense">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="text-ui text-ink-muted">
          {line}{' '}
          {(research.readyAt || running) && (
            <Link href={href} className={linkVariants()}>
              {research.readyAt ? 'Read it' : 'See the run'}
            </Link>
          )}
        </p>
        {!running && research.available && (
          <DashAction
            type="button"
            size="sm"
            variant="secondary"
            pending={pending}
            disabled={pending}
            onClick={start}
            routine="goals"
            what="Where the research runs"
            align="end"
          >
            {pending ? 'Starting…' : research.readyAt ? 'Refresh research' : 'Research this company'}
          </DashAction>
        )}
      </div>
      <FieldError>{error}</FieldError>
    </Card>
  );
}
