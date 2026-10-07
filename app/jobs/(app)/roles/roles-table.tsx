import Link from 'next/link';
import { cn } from '@/lib/cn';
import { StatusBadge } from '@/components/jobs/ui/status-badge';
import { CompanyAvatar } from '@/components/jobs/ui/company-avatar';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { formatCompBand, formatDate, shortAge, type PipelineRow } from '@/lib/jobs/applications/load';
import type { DisplayChoice } from '@/lib/list-display';
import { ScoreReasons, chanceFigureText, fitText } from '@/components/jobs/ui/score-figures';
import { CHANCE_LABEL, FIT_SCORE_LABEL } from '@/lib/jobs/suggest/scores';

/**
 * The roles table, lifted out of the page so it can be photographed.
 *
 * Nothing about it changed on the way out. The page still loads, filters and
 * sorts; this is the half a person reads, and the preview gallery cannot
 * import a page whose first line opens a database connection.
 */

export function hrefFor(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
  const query = search.toString();
  return query ? `/jobs/roles?${query}` : '/jobs/roles';
}

export function RolesTable({
  rows,
  sorts,
  hidden = [],
}: {
  rows: PipelineRow[];
  /**
   * The sort links, already built. They come from the same place the Display
   * panel's do, so a column header and the panel cannot disagree about what is
   * sorted or drop the grouping on the way.
   */
  sorts: DisplayChoice[];
  /** Column ids turned off in the Display panel. Never the role title. */
  hidden?: readonly string[];
}) {
  const showing = (property: string) => !hidden.includes(property);
  // Tighter than the table's own padding, so every column fits inside a
  // laptop's width rather than running off the right edge (law 2).
  const cell = 'px-2.5 first:pl-4 last:pr-4';
  // Date applied gives way first below 1536: the last activity beside it
  // says how fresh the role is, and the role page keeps the date.
  const narrowHidden = 'max-2xl:hidden';

  return (
    <>
      {/* A phone gets a short row a role: the title and company, then the
        * facts that have a value on one line (law 9). The stacked table gave
        * each role eight labelled lines, most of them empty. */}
      <ul className="divide-y divide-border md:hidden">
        {rows.map((row) => (
          <RoleRow key={row.applicationId} row={row} showing={showing} />
        ))}
      </ul>
      <div className="max-md:hidden">
    <Table>
      <THead>
        <TR>
          {sorts
            .filter((entry) => showing(entry.id))
            .map((entry) => (
              <TH key={entry.id} className={cn(cell, entry.id === 'applied' && narrowHidden)}>
                <Link
                  href={entry.href}
                  className={cn(
                    'transition-colors duration-quick',
                    entry.chosen ? 'text-accent' : 'hover:text-ink',
                  )}
                >
                  {entry.label}
                </Link>
              </TH>
            ))}
          {/* Comp is a column without a sort, so it is not in the list above
              and gets its own header. */}
          {showing('comp') && <TH num className={cell}>Comp</TH>}
        </TR>
      </THead>
      <TBody>
        {rows.map((row) => (
          // The row goes to the role; the company is a second destination
          // and stays a link of its own in its cell.
          <TR key={row.applicationId} href={`/jobs/roles/${row.roleId}`}>
            <TD primary className={cell}>
              {row.roleTitle}
              {row.attempt > 1 && (
                <span className="tabular ml-1.5 text-small font-normal text-ink-muted">
                  attempt {row.attempt}
                </span>
              )}
              {(showing('fit') || showing('chance')) && <ScoreReasons note={row.scoreNote} className="mt-0.5" />}
            </TD>
            {showing('company') && (
            <TD label="Company" className={cell}>
              {/* `relative z-over-link`: the primary cell's link stretches over the
                  whole row, so anything that is its own destination has to be
                  lifted out from under it. */}
              <Link
                href={`/jobs/companies/${row.companySlug}`}
                className="relative z-over-link flex items-center gap-2 text-ink-muted transition-colors duration-quick hover:text-accent max-md:justify-end"
              >
                <CompanyAvatar
                  company={{
                    name: row.companyName,
                    logoUrl: row.companyLogoUrl,
                    domains: row.companyDomains,
                    website: row.companyWebsite,
                  }}
                  className="size-5 rounded"
                  imageClassName="size-4"
                />
                <span className="max-w-32 truncate">{row.companyName}</span>
              </Link>
            </TD>
            )}
            {showing('status') && (
            <TD label="Status" className={cn(cell, 'whitespace-nowrap')}>
              <StatusBadge status={row.status} everSubmitted={row.submittedAt !== null} />
            </TD>
            )}
            {showing('activity') && (
            <TD label="Last activity" muted className={cn(cell, 'tabular')}>
              {shortAge(row.lastActivityAt)}
            </TD>
            )}
            {showing('applied') && (
            <TD label="Date applied" muted className={cn(cell, 'tabular whitespace-nowrap', narrowHidden)}>
              {shortDate(row.submittedAt)}
            </TD>
            )}
            {showing('excitement') && (
            <TD label="Excitement" muted className={cn(cell, 'tabular whitespace-nowrap')}>
              {row.excitement ? '★'.repeat(row.excitement) : '—'}
            </TD>
            )}
            {showing('fit') && (
             <TD label={FIT_SCORE_LABEL} muted className={cn(cell, 'tabular')} title={row.scoreNote?.fit?.unsure ? 'Dash is not sure of this one' : undefined}>
              {row.scoreNote ? (fitText(row.scoreNote) ?? '') : ''}
            </TD>
            )}
            {showing('chance') && (
            <TD label={CHANCE_LABEL} muted className={cell} title={row.scoreNote?.chance?.unsure ? 'Dash is not sure of this one' : undefined}>
              {row.scoreNote ? (chanceFigureText(row.scoreNote) ?? '') : ''}
            </TD>
            )}
            {showing('comp') && (
            <TD label="Comp" num muted className={cell}>
              {formatCompBand(row.compMinCents, row.compMaxCents) ?? '—'}
            </TD>
            )}
          </TR>
        ))}
      </TBody>
    </Table>
      </div>
    </>
  );
}

/** "14 Aug", with the year only when it is not this one: one line in the column. */
function shortDate(iso: string | null): string {
  const full = formatDate(iso);
  const year = String(new Date().getFullYear());
  return full.endsWith(` ${year}`) ? full.slice(0, -year.length - 1) : full;
}

function RoleRow({ row, showing }: { row: PipelineRow; showing: (property: string) => boolean }) {
  const fit = showing('fit') && row.scoreNote ? fitText(row.scoreNote) : null;
  const chance = showing('chance') && row.scoreNote ? chanceFigureText(row.scoreNote) : null;
  const comp = showing('comp') ? formatCompBand(row.compMinCents, row.compMaxCents) : null;
  const facts = [
    showing('activity') && row.lastActivityAt ? shortAge(row.lastActivityAt) : null,
    showing('excitement') && row.excitement ? '★'.repeat(row.excitement) : null,
    fit ? `${FIT_SCORE_LABEL} ${fit}` : null,
    chance ? `${chance} chance` : null,
    comp,
  ].filter(Boolean);

  return (
    <li className="relative row-pad px-4 hover:bg-sunken">
      <p className="min-w-0 truncate text-ui">
        <Link
          href={`/jobs/roles/${row.roleId}`}
          className="font-medium text-ink after:absolute after:inset-0 after:content-[''] hover:text-accent"
        >
          {row.roleTitle}
        </Link>
        {showing('company') && <span className="ml-1.5 text-ink-muted">{row.companyName}</span>}
      </p>
      <p className="mt-1 flex min-w-0 items-center gap-x-2 text-small text-ink-muted">
        {showing('status') && (
          <StatusBadge status={row.status} everSubmitted={row.submittedAt !== null} />
        )}
        {facts.length > 0 && <span className="tabular min-w-0 truncate">{facts.join(' · ')}</span>}
      </p>
    </li>
  );
}
