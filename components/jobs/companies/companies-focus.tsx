import { Card } from '@/components/ui/card';
import { LinkedText } from '@/components/ui/linked-text';
import { buttonVariants } from '@/components/ui/button';
import Link, { linkVariants } from '@/components/ui/link';
import { SectionHeading } from '@/components/ui/section-heading';
import { CompanyAvatar } from '@/components/jobs/ui/company-avatar';
import { CompanyDeck } from '@/components/jobs/companies/company-deck';
import { cn } from '@/lib/cn';
import { companyAvatarSrc } from '@/lib/jobs/companies/avatar';
import { formatDate } from '@/lib/jobs/applications/load';
import { IN_PROCESS_OR_LATER } from '@/lib/jobs/pipeline';
import {
  answeredCount,
  PERSPECTIVE_QUESTIONS,
  perspectiveOf,
} from '@/lib/jobs/companies/perspective';
import {
  clearFiltersHref,
  filterNames,
  focusHref,
  focusIndex,
  tableHref,
  type CompaniesParams,
  type CompaniesState,
  type CompanyRow,
} from '@/lib/jobs/companies-view';

/**
 * The Companies page's focused view (plan #2341.4): one company at a time,
 * in the order the table is sorted and within what it is filtered to. Each
 * company is drawn from what the page already loads (its facts and your
 * perspective on it), with no data of its own, and the deck steps through
 * them (company-deck.tsx).
 */
export function CompaniesFocus({
  rows,
  params,
  state,
  timezone,
}: {
  /** The filtered companies, in the table's order. */
  rows: readonly CompanyRow[];
  params: CompaniesParams;
  state: CompaniesState;
  timezone: string;
}) {
  if (rows.length === 0) {
    return (
      <Card padding="standard" className="py-10 text-center">
        <p className="text-body font-medium text-ink">No companies match these filters</p>
        <p className="mt-1 text-small text-ink-muted">{filterNames(state).join(' · ')}</p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Link href={tableHref(params)} className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
            Back to the table
          </Link>
          <Link href={clearFiltersHref(params)} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
            Clear filters
          </Link>
        </div>
      </Card>
    );
  }

  return (
    <CompanyDeck
      // A new list (a filter changed) starts again where the address says.
      key={rows.map((row) => row.slug).join(' ')}
      start={focusIndex(rows, state.company)}
      companies={rows.map((company) => ({
        key: company.slug,
        href: focusHref(params, company.slug),
        body: <CompanyFocusCard company={company} timezone={timezone} />,
        image: companyAvatarSrc(avatarOf(company)),
        actions: (
          <Link
            href={`/jobs/companies/${company.slug}`}
            className={buttonVariants({ variant: 'secondary', size: 'lg' })}
          >
            Open
          </Link>
        ),
      }))}
    />
  );
}

function avatarOf(company: CompanyRow) {
  return {
    name: company.name,
    logoUrl: company.logo_url,
    domains: company.domains,
    website: company.website,
    careersUrl: company.careers_url,
  };
}

function roleLine(company: CompanyRow): string {
  const roles = company.roles.length;
  if (roles === 0) return 'None tracked';
  const live = company.roles.filter((role) =>
    role.applications.some((application) => IN_PROCESS_OR_LATER.includes(application.status)),
  ).length;
  const noun = roles === 1 ? 'role' : 'roles';
  return live > 0 ? `${roles} ${noun} · ${live} in process or beyond` : `${roles} ${noun}`;
}

function ExternalLink({ href }: { href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className={cn(linkVariants(), 'press-area break-all')}
    >
      {href.replace(/^https?:\/\//, '').replace(/\/$/, '')}
    </a>
  );
}

/** The facts that have a value, as label and value. */
function facts(company: CompanyRow): Array<[string, React.ReactNode]> {
  const list: Array<[string, React.ReactNode]> = [
    ['Priority', company.priority],
    ['Activity', company.status.replace(/_/g, ' ')],
    ['Roles', roleLine(company)],
  ];
  if (company.domains.length > 0) list.push(['Domains', company.domains.join(', ')]);
  if (company.website) list.push(['Homepage', <ExternalLink key="w" href={company.website} />]);
  if (company.careers_url) {
    list.push(['Careers page', <ExternalLink key="c" href={company.careers_url} />]);
  }
  return list;
}

/** One company in full: who they are, where you stand, and your view of them. */
export function CompanyFocusCard({ company, timezone }: { company: CompanyRow; timezone: string }) {
  const perspective = perspectiveOf(company as unknown as Record<string, unknown>);
  const answered = PERSPECTIVE_QUESTIONS.filter((q) => perspective[q.key].trim() !== '');
  const open = PERSPECTIVE_QUESTIONS.filter((q) => perspective[q.key].trim() === '');
  const place = [company.industry, company.hq_location].filter(Boolean).join(' · ');

  return (
    <Card padding="standard" className="space-y-6">
      <div className="flex items-center gap-3">
        <CompanyAvatar
          company={avatarOf(company)}
          className="size-11 shrink-0 rounded-control"
          imageClassName="size-7"
        />
        <div className="min-w-0">
          <h2 className="text-title font-semibold text-ink">{company.name}</h2>
          {place && <p className="text-ui text-ink-muted">{place}</p>}
        </div>
      </div>

      {/* A label column beside the values at every width, so six short facts
          take six lines on a phone too. A fact with no value is left out. */}
      <dl className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-4 gap-y-2 text-ui">
        {facts(company).map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-ink-muted">{label}</dt>
            <dd className="min-w-0 text-ink">{value}</dd>
          </div>
        ))}
      </dl>

      <section aria-label="Your view">
        <SectionHeading
          title="Your view"
          count={`${answeredCount(perspective)} of ${PERSPECTIVE_QUESTIONS.length}`}
          className="mb-2"
        />
        {answered.length > 0 && (
          <dl className="space-y-3">
            {answered.map((question) => (
              <div key={question.key}>
                <dt className="text-small text-ink-muted">{question.label}</dt>
                <dd className="text-body whitespace-pre-line text-ink">
                  <LinkedText text={perspective[question.key]} refs={false} />
                </dd>
              </div>
            ))}
          </dl>
        )}
        {open.length > 0 && (
          <p className={cn('text-small text-ink-muted', answered.length > 0 && 'mt-3')}>
            Not answered yet: {open.map((q) => q.label.toLowerCase()).join(', ')}.
          </p>
        )}
        <p className="tabular mt-1 text-small text-ink-muted">
          {company.perspective_updated_at
            ? `Updated ${formatDate(company.perspective_updated_at, timezone)}`
            : 'Never updated'}
        </p>
      </section>
    </Card>
  );
}
