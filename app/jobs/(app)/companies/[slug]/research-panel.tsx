'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ExternalLink } from 'lucide-react';
import { cn } from '@/lib/cn';
import { DashAction } from '@/components/ui/dash-action';
import { CardSection } from '@/components/ui/card';
import { Banner } from '@/components/ui/banner';
import { Disclosure, SectionFold } from '@/components/ui/disclosure';
import { FieldError } from '@/components/ui/field';
import { linkVariants } from '@/components/ui/link';
import { Markdown } from '@/components/ui/markdown';
import { formatDate, formatDateTime } from '@/lib/jobs/applications/load';
import { safeUrl, sourcesByKind, type CompanyResearch } from '@/lib/jobs/companies/research';
import { startCompanyResearch } from '../actions';

/** How often a page with a run going looks again, and for how long. */
const POLL_MS = 60_000;
const POLL_FOR_MS = 60 * 60_000;

/**
 * Refresh the page while a run is going, so the write-up replaces the
 * "researching" line when the routine finishes without a reload. Only while
 * the tab is visible, and for an hour at most: a run that takes longer has
 * stopped, and the stale check on the next press says so.
 */
function useRefreshWhileRunning(running: boolean) {
  const router = useRouter();
  useEffect(() => {
    if (!running) return;
    const started = Date.now();
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - started > POLL_FOR_MS) {
        window.clearInterval(timer);
        return;
      }
      router.refresh();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [running, router]);
}

/**
 * Prepared research on the company: what the company research routine found
 * reading its own materials, filings, news, talks and postings, and the
 * person's own mail and notes about it (.claude/skills/company-research).
 *
 * `latest` is the newest run whatever its state, which is what says whether
 * one is going or the last one failed; `shown` is the newest finished one,
 * which stays on screen through a refresh and after a failed one.
 */
export function ResearchPanel({
  companyId,
  latest,
  shown,
  timezone,
  available,
}: {
  companyId: string;
  latest: CompanyResearch | null;
  shown: CompanyResearch | null;
  timezone: string;
  /** Whether the deployment can start the research routine (both its variables set). */
  available: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const running = latest?.status === 'queued' || latest?.status === 'researching';
  useRefreshWhileRunning(running);

  const start = () =>
    startTransition(async () => {
      const result = await startCompanyResearch(companyId);
      setError(result.error);
    });

  const meta = running
    ? 'Researching'
    : shown
      ? `${shown.sources.length} sources · ${formatDate(shown.finishedAt ?? shown.requestedAt, timezone)}`
      : undefined;

  return (
    <CardSection
      title="Research"
      meta={meta}
      action={
        running || !available ? undefined : (
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
            {pending ? 'Starting…' : shown ? 'Refresh research' : 'Research this company'}
          </DashAction>
        )
      }
    >
      <div className="mt-2 space-y-3">
        <FieldError>{error}</FieldError>

        {running && latest && (
          <Banner tone="info">
            <p>
              Dash is reading up on this company, started{' '}
              {formatDateTime(latest.requestedAt, timezone)}. It takes 20 to 40 minutes, and this
              page fills in when it is done.
              {latest.runUrl && (
                <>
                  {' '}
                  <a
                    href={latest.runUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className={linkVariants()}
                  >
                    Watch the run
                  </a>
                </>
              )}
            </p>
          </Banner>
        )}

        {latest?.status === 'failed' && (
          <Banner tone="warn">
            <p>{latest.error ?? 'The last research run did not finish.'}</p>
          </Banner>
        )}

        {!available && !running && (
          <p className="text-ui text-ink-muted">
            Research is not set up on this deployment yet. It runs on the goals routine,
            which needs CLAUDE_GOALS_ROUTINE_ID and CLAUDE_GOALS_ROUTINE_TOKEN.
          </p>
        )}

        {available && !shown && !running && (
          <p className="text-ui text-ink-muted">
            Dash reads their site, filings, news, talks and job postings, and your own mail and
            notes about them, then writes up what it finds with a link on every claim and a list
            of every page it read. It takes 20 to 40 minutes.
          </p>
        )}

        {shown && <ResearchWriteUp research={shown} />}
      </div>
    </CardSection>
  );
}

const linkOnly = (href: string | undefined) => safeUrl(href);

/**
 * The write-up's inline links drawn as links. Markdown leaves an anchor
 * unstyled, so a citation such as "(TechCrunch)" read as plain text in the
 * paragraph it sat in; these are linkVariants' inline tone, set on every
 * anchor inside, with the phone press area.
 */
const PROSE = cn(
  'text-ui text-ink',
  '[&_a]:text-accent [&_a]:underline [&_a]:underline-offset-2 [&_a]:decoration-accent/40',
  'hover:[&_a]:decoration-accent [&_a]:press-area',
);

function ResearchWriteUp({ research }: { research: CompanyResearch }) {
  const groups = sourcesByKind(research.sources);

  return (
    <div className="space-y-3">
      {research.summary && (
        <Markdown markdown={research.summary} resolveHref={linkOnly} className={PROSE} />
      )}

      <div className="space-y-1">
        {research.sections.map((section, index) => (
          <Disclosure key={section.key} title={section.title} defaultOpen={index === 0}>
            <Markdown markdown={section.body} resolveHref={linkOnly} className={PROSE} />
          </Disclosure>
        ))}
      </div>

      {groups.length > 0 && (
        <SectionFold title="Sources" count={research.sources.length} defaultOpen={false}>
          <div className="space-y-4">
            {groups.map((group) => (
              <div key={group.kind}>
                <h3 className="text-small font-medium text-ink-muted">{group.label}</h3>
                <ul className="mt-1 space-y-2">
                  {group.sources.map((source) => (
                    <li key={source.url} className="text-ui">
                      <a
                        href={source.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className={cn(linkVariants(), 'press-area inline-flex items-baseline gap-1')}
                      >
                        {source.title}
                        <ExternalLink aria-hidden strokeWidth={1.75} className="size-3 shrink-0 self-center" />
                      </a>
                      {(source.publisher || source.publishedOn) && (
                        <span className="text-small text-ink-muted">
                          {' '}
                          · {[source.publisher, source.publishedOn].filter(Boolean).join(', ')}
                        </span>
                      )}
                      {source.note && <p className="text-small text-ink-muted">{source.note}</p>}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </SectionFold>
      )}
    </div>
  );
}
