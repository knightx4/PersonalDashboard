import Link from 'next/link';
import { Card } from '@/components/ui/card';
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

/**
 * Every live application, grouped by whose move it is, under the numbers
 * that say where the search stands (plan #1151, #1591).
 *
 * The numbers each open the applications they counted: Live opens Pipeline,
 * which opens on the live ones; a stage opens the table narrowed to it; sent
 * opens the table narrowed to what was sent in the window, closed or not; and
 * the interviews go to This week, higher on this page, which lists them.
 *
 * The groups are lib/jobs/today/live.ts's: yours, theirs, and the ones not
 * sent yet. A group with nothing in it is left out (law 1).
 */
export function LiveSection({ summary, live }: { summary: SearchSummary; live: LiveByMove }) {
  // Each label has a short form for a phone, where seven numbers have to
  // fit two rows of four without a label wrapping.
  const stats: Array<{ label: string; short: string; value: string; href: string }> = [
    { label: 'Live', short: 'Live', value: String(summary.live), href: PIPELINE_PATH },
    ...summary.byStage.map((stage) => ({
      label: stage.label,
      short: stage.key === 'unsent' ? 'Not sent' : stage.label,
      value: String(stage.count),
      href: stageHref(stage.key),
    })),
    {
      label: `Sent in ${SENT_WINDOW_DAYS} days`,
      short: `Sent ${SENT_WINDOW_DAYS}d`,
      value: String(summary.sentRecently),
      href: sentHref(),
    },
    {
      label: `Interviews in ${INTERVIEW_HORIZON_DAYS} days`,
      short: 'Interviews',
      // Law 2: a failed read says so rather than passing for none.
      value: summary.interviewsSoon === null ? 'Could not load' : String(summary.interviewsSoon),
      href: '#this-week',
    },
  ];

  return (
    <HomeSection
      id="live"
      title="Live applications"
      more={{ href: PIPELINE_PATH, label: 'Open Pipeline' }}
    >
      <Card padding="standard">
        <dl className="grid grid-cols-4 gap-x-2 gap-y-3 sm:flex sm:flex-wrap sm:gap-x-8">
          {stats.map((stat) => (
            <div key={stat.label} className="flex min-w-0 flex-col-reverse">
              <dt className="text-small whitespace-nowrap text-ink-muted">
                <span className="sm:hidden" aria-hidden={stat.short !== stat.label || undefined}>
                  {stat.short}
                </span>
                {stat.short !== stat.label && <span className="max-sm:sr-only">{stat.label}</span>}
                {stat.short === stat.label && <span className="max-sm:hidden">{stat.label}</span>}
              </dt>
              <dd className="tabular text-body font-semibold tracking-tight text-ink">
                <Link
                  href={stat.href}
                  className="press-area transition-colors duration-quick hover:text-accent"
                >
                  {stat.value}
                </Link>
              </dd>
            </div>
          ))}
        </dl>
      </Card>

      {live.total === 0 ? (
        <p className="px-1 text-small text-ink-muted">
          Nothing live: every application has closed, and there are no leads.
        </p>
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
      <h3 className="mb-1 text-ui font-semibold text-ink">
        {title} <span className="tabular font-normal text-ink-muted">· {rows.length}</span>
      </h3>
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
              <span
                className="block truncate text-small text-ink-muted sm:shrink-0"
                title={row.why}
              >
                {row.todo ? `${row.stage} · ${row.todo}` : row.stage}
              </span>
            </div>
            <span
              className="tabular shrink-0 text-small text-ink-muted"
              title="Days since anything happened on it"
            >
              {ageOf(row.daysSinceActivity)}
            </span>
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
