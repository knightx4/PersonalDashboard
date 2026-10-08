'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CardSection } from '@/components/ui/card';
import { DashMark } from '@/components/ui/dash-mark';
import { PaidHint } from '@/components/ui/paid-hint';
import { cn } from '@/lib/cn';
import { FIT_SCORE_LABEL } from '@/lib/jobs/suggest/scores';
import { companyFacts, type DiscoveredCompany, type DiscoveryLine } from '@/lib/jobs/discover/watchlist-view';
import { addDiscoveredCompany, findStartups } from './actions';

/** Rows shown before "Show all": the best matches. */
const TOP = 10;

/**
 * The startups the weekly discovery found (feature #1679), best fit first,
 * with what each does and why Dash picked it. Their open roles reach the
 * recommended roles above; this is the list of companies behind them, and
 * the button runs the search now rather than waiting for Monday.
 */
export function DiscoveredCompanies({
  companies,
  status,
}: {
  companies: DiscoveredCompany[];
  /** How the latest startup search went (watchlist-view.ts `describeDiscovery`). */
  status: DiscoveryLine | null;
}) {
  const [pending, run] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const router = useRouter();
  const searching = pending || !!status?.running;

  // A run started elsewhere (the Monday schedule, another tab) shows its
  // result without a reload.
  useEffect(() => {
    if (!status?.running || pending) return;
    const timer = window.setInterval(() => router.refresh(), 8000);
    return () => window.clearInterval(timer);
  }, [status?.running, pending, router]);

  const ask = () => {
    setNotice(null);
    run(async () => {
      const result = await findStartups();
      setNotice(result.error ?? result.message ?? null);
      router.refresh();
    });
  };

  const shown = all ? companies : companies.slice(0, TOP);

  return (
    <CardSection
      fold="jobs.fold.Discovered companies"
      title={
        <>
          <DashMark size="icon" decorative className="self-center text-accent" />
          Discovered companies
        </>
      }
      meta={companies.length > 0 ? companies.length : undefined}
    >
      <div className="mb-2 flex items-start gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          {companies.length === 0 && (
            <p className="text-small text-ink-muted">
              Startups from YC and the Hacker News hiring thread that fit what you want, scored by Dash. The search runs every Monday; their open roles appear in Recommended roles.
            </p>
          )}
          {status && (
            <p role="status" className={cn('text-small', status.tone === 'warn' ? 'text-caution' : 'text-ink-muted')}>
              {pending ? 'Looking for startups… This takes a minute or two.' : status.text}
            </p>
          )}
          {!status && pending && (
            <p role="status" className="text-small text-ink-muted">
              Looking for startups… This takes a minute or two.
            </p>
          )}
          {notice && <p className="text-small text-ink-muted">{notice}</p>}
        </div>
        <span className="flex shrink-0 items-center gap-1">
          <Button type="button" size="sm" variant="secondary" pending={searching} onClick={ask}>
            {searching ? 'Searching…' : 'Find startups'}
          </Button>
          <PaidHint action="app/jobs/(app)/find/actions.ts#findStartups" what="Cost of a startup search" align="end" />
        </span>
      </div>

      {companies.length > 0 && (
        <ul className="divide-y divide-border">
          {shown.map((company) => (
            <CompanyRow key={company.id} company={company} />
          ))}
        </ul>
      )}
      {companies.length > TOP && (
        <div className="mt-2 flex justify-end border-t border-border pt-2">
          <Button type="button" size="sm" variant="ghost" onClick={() => setAll((open) => !open)}>
            {all ? `Show the top ${TOP}` : `Show all ${companies.length}`}
          </Button>
        </div>
      )}
    </CardSection>
  );
}

function CompanyRow({ company }: { company: DiscoveredCompany }) {
  const facts = companyFacts(company);
  const [adding, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const add = () =>
    start(async () => {
      const result = await addDiscoveredCompany(company.id);
      setError(result.error);
    });
  return (
    <li className="row-pad space-y-1">
      <div className="flex items-baseline gap-2">
        {company.score !== null && (
          <span className="tabular shrink-0 rounded-control bg-sunken px-1.5 py-0.5 text-small text-ink-muted">
            {FIT_SCORE_LABEL} {company.score}
          </span>
        )}
        <h3 className="min-w-0 text-ui font-medium text-ink">
          {company.website ? (
            <a
              href={company.website}
              target="_blank"
              rel="noreferrer"
              className="group/title press-area hover:text-accent"
            >
              {company.name}
              <ExternalLink
                className="ml-1 inline size-3.5 align-[-2px] text-ink-ghost group-hover/title:text-accent"
                strokeWidth={1.75}
                aria-label="Opens the company's website"
              />
            </a>
          ) : (
            company.name
          )}
        </h3>
      </div>
      <p className="text-small text-ink-muted">{facts.join(' · ')}</p>
      {company.description && <p className="text-ui text-ink">{company.description}</p>}
      {company.postingRoles.length > 0 && (
        <p className="text-small text-ink-muted">Hiring for {company.postingRoles.join(', ')}</p>
      )}
      {company.reason && <p className="text-small text-ink-muted">{company.reason}</p>}
      <div className="flex flex-wrap items-center gap-2 pt-0.5">
        {company.companySlug ? (
          <Link href={`/jobs/companies/${company.companySlug}`} className="press-area text-small text-accent hover:underline">
            On your companies list
          </Link>
        ) : (
          <Button type="button" size="sm" variant="secondary" pending={adding} onClick={add}>
            {adding ? 'Adding…' : 'Add to my companies'}
          </Button>
        )}
        {error && <p className="text-small text-caution">{error}</p>}
      </div>
    </li>
  );
}
