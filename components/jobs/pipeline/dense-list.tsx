'use client';

import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/cn';
import { CompanyAvatar } from '@/components/jobs/ui/company-avatar';
import type { PipelineRow } from '@/lib/jobs/applications/load';
import { shortAge } from '@/lib/jobs/applications/load';
import { type ApplicationStatus } from '@/lib/jobs/pipeline';

/**
 * The pipeline as a list you read, rather than a stack of cards you scroll.
 *
 * This is an experiment, deliberately built beside the existing list rather
 * than replacing it, so the two can be photographed at the same width and
 * judged against each other rather than against a memory.
 *
 * The claim it is testing: what makes this app feel heavy next to Linear is
 * not padding or radius, it is that **a row is a card**. A card has its own
 * surface, its own edge, its own margin, and an avatar tile sized to the card
 * rather than to the line -- and once a row costs 95px, a screen holds nine of
 * two hundred and seventy-one pursuits. Linear's row is about 36px and holds
 * twenty-five, and every difference in feel follows from that ratio rather
 * than from any single token.
 *
 * So this takes the four things away and changes nothing else:
 *
 *   1. **No card.** One row, one hairline between rows, hover for the
 *      highlight. The group is the container; the rows are its contents.
 *   2. **No margin.** Cards need space between them because each is an
 *      object. Rows do not: the divider is the separation, and it costs one
 *      pixel instead of eight.
 *   3. **One line.** Role and company share it -- the title in ink, the
 *      company muted after it, the way a subject and a sender share a line in
 *      every mail client ever written. Two lines per row is what forces 95px.
 *   4. **Nothing empty is drawn.** A stage with no pursuits is not a heading
 *      with a zero after it; it is absent. Law 1, applied to the one screen
 *      where it costs the most -- two of six stages were empty in the shot
 *      that prompted this, and both were rendered with their descriptions.
 *
 * The hint sentences go too. "Saved, not applied", "Sent, and landed
 * somewhere real" -- a heading that has to explain itself on every viewing is
 * documentation, and after the second read it is furniture. The counts stay,
 * because a count is a fact.
 */

const STAGES: Array<{ statuses: ApplicationStatus[]; label: string }> = [
  { statuses: ['lead'], label: 'Leads' },
  { statuses: ['drafting'], label: 'Drafting' },
  { statuses: ['submitted', 'acknowledged'], label: 'Submitted' },
  { statuses: ['in_process', 'final_round'], label: 'In process' },
  { statuses: ['offer'], label: 'Offer' },
];

const STALE_DAYS = 14;

export function PipelineDenseList({ rows }: { rows: readonly PipelineRow[] }) {
  return (
    <div className="space-y-5">
      {STAGES.map((stage) => {
        const inStage = rows.filter((row) => stage.statuses.includes(row.status));
        // Law 1. An empty stage is not a heading with a zero after it.
        if (inStage.length === 0) return null;

        return (
          <section key={stage.label}>
            <h2 className="mb-1 flex items-baseline gap-2 px-2 text-ui font-semibold text-ink">
              {stage.label}
              <span className="tabular text-small font-normal text-ink-ghost">
                {inStage.length}
              </span>
            </h2>
            <ul className="divide-y divide-border">
              {inStage.map((row) => (
                <PipelineLine key={row.applicationId} row={row} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/**
 * One pursuit, one line.
 *
 * `h-9` is the whole point and is written here rather than taken from the
 * density dial on purpose: the dial's job is to tune a comfortable default,
 * and this is testing whether the comfortable default is the problem. If the
 * experiment survives, this becomes a token.
 */
function PipelineLine({ row }: { row: PipelineRow }) {
  const stale = (row.daysSinceActivity ?? 0) > STALE_DAYS;

  return (
    <li>
      <Link
        href={`/jobs/roles/${row.roleId}`}
        // ui-ok: fixed-control-height -- the number is the experiment. This is
        // a row, not a control, and it is written flat rather than taken from
        // the dial because the question being asked is whether the dial's
        // comfortable default is itself the problem. A token here would beg it.
        className="group/row flex h-9 items-center gap-2 rounded-control px-2 hover:bg-shell-hover"
      >
        <CompanyAvatar
          company={{
            name: row.companyName,
            logoUrl: row.companyLogoUrl,
            domains: row.companyDomains,
            website: row.companyWebsite,
          }}
          className="size-4 shrink-0 text-micro"
        />

        {/* Title and company on one line, the way a mail client puts a subject
          * beside its sender. `min-w-0` on the flex child is what lets the
          * title truncate instead of pushing the numbers off the row. */}
        <span className="min-w-0 flex-1 truncate text-ui text-ink">
          {row.roleTitle}
          <span className="ml-2 text-ink-muted">{row.companyName}</span>
        </span>

        {row.needsReview && (
          <AlertTriangle
            className="size-3.5 shrink-0 text-caution"
            strokeWidth={2}
            aria-label="Needs review"
          />
        )}

        {/* Excitement as a count rather than five glyphs: at this height the
          * stars were most of the row's ink for one number. */}
        {(row.excitement ?? 0) > 0 && (
          <span className="tabular shrink-0 text-micro text-ink-ghost" title="Excitement">
            {'★'.repeat(row.excitement ?? 0)}
          </span>
        )}

        {row.coverage.total > 0 && (
          <span
            className={cn(
              'tabular w-10 shrink-0 text-right text-micro',
              row.coverage.gaps > 0 ? 'text-caution' : 'text-ink-ghost',
            )}
            title="Requirements covered by your evidence"
          >
            {row.coverage.covered}/{row.coverage.total}
          </span>
        )}

        <span
          className={cn(
            'tabular w-10 shrink-0 text-right text-micro',
            stale ? 'text-caution' : 'text-ink-ghost',
          )}
        >
          {shortAge(row.lastActivityAt)}
        </span>
      </Link>
    </li>
  );
}
