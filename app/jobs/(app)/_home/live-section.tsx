import Link from '@/components/ui/link';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { SectionHeading } from '@/components/ui/section-heading';
import { Stat } from '@/components/ui/stat';
import { MOVE_WORD } from '@/lib/core/move';
import {
  INTERVIEW_HORIZON_DAYS,
  SENT_WINDOW_DAYS,
  sentHref,
  stageHref,
  type SearchSummary,
} from '@/lib/jobs/home/summary';
import { PIPELINE_PATH } from '@/lib/jobs/pipeline-view';
import type { LiveApplication, LiveByMove } from '@/lib/jobs/today/live';
import { HomeSection } from './home-section';
import { Tooltip } from '@/components/ui/tooltip';

/**
 * The numbers that say where the search stands, in Now's rail (plan #1151,
 * #1591, #1937.9).
 *
 * Each opens the applications it counted: Live opens Pipeline, which opens
 * on the live ones; a stage opens the table narrowed to it; sent opens the
 * table narrowed to what was sent in the window, closed or not; and the
 * interviews go to This week, which lists them.
 */
export function SearchNumbers({ summary }: { summary: SearchSummary }) {
  const stats: Array<{ label: string; value: string; href: string }> = [
    { label: 'Live', value: String(summary.live), href: PIPELINE_PATH },
    ...summary.byStage.map((stage) => ({
      label: stage.key === 'unsent' ? 'Not sent' : stage.label,
      value: String(stage.count),
      href: stageHref(stage.key),
    })),
    {
      label: `Sent in ${SENT_WINDOW_DAYS} days`,
      value: String(summary.sentRecently),
      href: sentHref(),
    },
    {
      label: `Interviews in ${INTERVIEW_HORIZON_DAYS} days`,
      // Law 2: a failed read says so rather than passing for none.
      value: summary.interviewsSoon === null ? 'Could not load' : String(summary.interviewsSoon),
      href: '#this-week',
    },
  ];

  return (
    <HomeSection id="numbers" title="Where the search stands">
      <Card padding="standard">
        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
          {stats.map((stat) => (
            <Link
              key={stat.label}
              href={stat.href}
              className="press-area min-w-0 transition-colors duration-quick hover:[&_p:first-child]:text-accent"
            >
              <Stat size="sm" value={stat.value} label={stat.label} />
            </Link>
          ))}
        </div>
      </Card>
    </HomeSection>
  );
}

/**
 * Every live application, grouped by whose move it is (plan #1151, #1591).
 * The numbers that sat above them are in the rail since plan #1937.9.
 *
 * The groups are lib/jobs/today/live.ts's: yours, theirs, and the ones not
 * sent yet. A group with nothing in it is left out (law 1).
 */
export function LiveSection({ live }: { live: LiveByMove }) {
  return (
    <HomeSection
      id="live"
      title="Live applications"
      more={{ href: PIPELINE_PATH, label: 'Open Pipeline' }}
    >
      {live.total === 0 ? (
        <EmptyState
          size="inline"
          title="Nothing live: every application has closed, and there are no leads."
          className="px-1"
        />
      ) : (
        <>
          <MoveGroup title={MOVE_WORD.on_you} rows={live.onYou} />
          <MoveGroup title="Waiting on them" rows={live.waiting} />
          <MoveGroup title="Not sent yet" rows={live.unsent} />
        </>
      )}
    </HomeSection>
  );
}

function MoveGroup({ title, rows }: { title: string; rows: readonly LiveApplication[] }) {
  if (rows.length === 0) return null;
  return (
    <Card padding="dense">
      <SectionHeading as="h3" title={title} count={rows.length} className="mb-1" />
      <ul className="divide-y divide-border">
        {rows.map((row) => (
          // On a phone, the name on one line and the stage under it, with the
          // age on the right of the name; on a laptop, all of it on one line.
          <li key={row.applicationId} className="row-pad relative flex items-baseline gap-x-3">
            <div className="min-w-0 flex-1 sm:flex sm:items-baseline sm:gap-x-3">
              <Link
                href={`/jobs/roles/${row.roleId}`}
                className="press-area block truncate text-ui font-medium text-ink transition-colors duration-quick hover:text-accent sm:shrink"
              >
                {/* The whole row opens the role, not only its name. */}
                <span className="absolute inset-0" aria-hidden />
                {row.companyName} · {row.roleTitle}
              </Link>
              {row.why ? (
                <Tooltip label={row.why} className="flex min-w-0 sm:shrink-0">
                  <span tabIndex={0} className="block min-w-0 truncate text-small text-ink-muted">
                    {row.todo ? `${row.stage} · ${row.todo}` : row.stage}
                  </span>
                </Tooltip>
              ) : (
                <span className="block truncate text-small text-ink-muted sm:shrink-0">
                  {row.todo ? `${row.stage} · ${row.todo}` : row.stage}
                </span>
              )}
            </div>
            <Tooltip label="Days since anything happened on it" align="end" className="shrink-0">
              <span tabIndex={0} className="tabular text-small text-ink-muted">
                {ageOf(row.daysSinceActivity)}
              </span>
            </Tooltip>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** "today", "3d": the board's way of saying how long it has been quiet. */
function ageOf(days: number | null): string {
  if (days === null) return '—';
  return days === 0 ? 'today' : `${days}d`;
}
