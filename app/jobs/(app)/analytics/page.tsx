import { BarChart3 } from 'lucide-react';
import { createClient, requireUser } from '@/lib/jobs/auth/server';
import { PageHeader } from '@/components/shell/page-header';
import { CardSection } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Figure } from '@/components/ui/figure';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { loadPipeline, toFunnelApplications } from '@/lib/jobs/applications/load';
import {
  RESPONSE_WINDOW_DAYS,
  SOURCE_LABELS,
  advanceRate,
  countReaching,
  formatDays,
  formatRate,
  funnelMetrics,
  metricsBySource,
  monthlyCohorts,
  rejectionStageDistribution,
  type ApplicationStatus,
} from '@/lib/jobs/pipeline';

export const metadata = { title: 'Analytics' };

/**
 * Every number on this page comes from lib/pipeline.ts. Nothing is computed
 * inline here — a lint rule blocks the shape, and the reason is that a rate
 * with a quietly wrong denominator looks exactly like a rate with a right one.
 */

const LADDER: Array<{ stage: ApplicationStatus; label: string }> = [
  { stage: 'submitted', label: 'Sent' },
  { stage: 'acknowledged', label: 'Acknowledged' },
  { stage: 'in_process', label: 'Reached a human' },
  { stage: 'final_round', label: 'Final round' },
  { stage: 'offer', label: 'Offer' },
];

const STAGE_LABELS: Record<string, string> = {
  pre_screen: 'Before any screen',
  resume_review: 'Resume review',
  recruiter_screen: 'Recruiter screen',
  hiring_manager: 'Hiring manager',
  technical: 'Technical',
  onsite: 'Onsite',
  final: 'Final round',
  offer_stage: 'At offer',
  unknown: 'Unknown',
};

export default async function AnalyticsPage() {
  const user = await requireUser();
  const supabase = await createClient();

  const rows = await loadPipeline(supabase, user.id);
  const applications = toFunnelApplications(rows);
  const sent = applications.filter((a) => a.submittedAt !== null);

  if (sent.length === 0) {
    return (
      <>
        <PageHeader title="Analytics" description="Where in the funnel you are losing, and whether that differs by channel." />
        <EmptyState
          icon={BarChart3}
          title="Nothing to measure yet"
          description="These numbers need applications with a submission date. They start being useful at about fifteen, and trustworthy at about forty."
          action={{ label: 'Add a role', href: '/jobs/roles/new' }}
        />
      </>
    );
  }

  const overall = funnelMetrics(applications);
  const bySource = metricsBySource(applications);
  const cohorts = monthlyCohorts(applications);
  const rejections = rejectionStageDistribution(applications);
  const reached = (stage: ApplicationStatus) => countReaching(applications, stage);

  return (
    <>
      <PageHeader
        title="Analytics"
        description="Where in the funnel you are losing, and whether that differs by channel."
      />

      {/* The response rate is the number the search turns on, so it is the
          figure; the three that used to share a grid with it are its
          supporting row. */}
      <Figure
        className="mb-8"
        label="Human response rate"
        meta={`${overall.applicationsSent} sent`}
        value={formatRate(overall.responseRate)}
        caption="Automated confirmations and bulk rejections are excluded."
        secondary={[
          { value: String(overall.applicationsSent), label: 'applications sent' },
          {
            value: formatRate(overall.confirmationRate),
            label: 'confirmed as received — not progress, only proof it landed',
          },
          { value: formatDays(overall.medianDaysToResponse), label: 'median days to a reply' },
        ]}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <CardSection
          title="The funnel"
          hint="Each bar is everything that ever reached that rung — a rejection after an onsite still counts as having reached the onsite."
        >
          <ul className="mt-3 space-y-2">
            {LADDER.map((rung, index) => {
              const count = reached(rung.stage);
              const share = overall.applicationsSent === 0 ? 0 : count / overall.applicationsSent;
              const advance = index === 0 ? null : advanceRate(applications, LADDER[index - 1].stage);
              return (
                <li key={rung.stage}>
                  <div className="flex items-baseline justify-between gap-2 text-ui">
                    <span className="text-ink">{rung.label}</span>
                    <span className="tabular text-ink-muted">
                      {count}
                      <span className="ml-2 text-ink-muted">{formatRate(share)}</span>
                    </span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-canvas">
                    <div
                      className="h-full rounded-full bg-accent"
                      style={{ width: `${Math.max(share * 100, count > 0 ? 2 : 0)}%` }}
                    />
                  </div>
                  {advance !== null && (
                    <p className="tabular mt-0.5 text-small text-ink-muted">
                      {formatRate(advance)} advanced from {LADDER[index - 1].label.toLowerCase()}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </CardSection>

        <CardSection
          title="By channel"
          hint="The comparison a single blended number hides. This is usually the most actionable table in the app."
        >
          <div className="mt-3">
            <Table flush>
              <THead>
                <TR>
                  <TH>Source</TH>
                  <TH num>Sent</TH>
                  <TH num>Replied</TH>
                  <TH num>Screened</TH>
                  <TH num>Ghosted</TH>
                </TR>
              </THead>
              <TBody>
                {bySource.map(({ source, metrics }) => (
                  <TR key={source}>
                    <TD primary>{SOURCE_LABELS[source]}</TD>
                    <TD label="Sent" num muted>
                      {metrics.applicationsSent}
                    </TD>
                    <TD label="Replied" num>
                      {formatRate(metrics.responseRate)}
                    </TD>
                    <TD label="Screened" num muted>
                      {formatRate(metrics.screenRate)}
                    </TD>
                    <TD label="Ghosted" num muted>
                      {formatRate(metrics.ghostRate)}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        </CardSection>

        <CardSection
          title="By month applied"
          hint="Cohorted by submission date, always. Applications sent in June stay the June cohort forever and their response rate fills in as replies arrive."
        >
          <div className="mt-3">
            <Table flush>
              <THead>
                <TR>
                  <TH>Month</TH>
                  <TH num>Sent</TH>
                  <TH num>Replied</TH>
                  <TH num>Screened</TH>
                </TR>
              </THead>
              <TBody>
                {cohorts.map(({ period, metrics }) => (
                  <TR key={period.label}>
                    <TD primary className="tabular">
                      {period.label}
                    </TD>
                    <TD label="Sent" num muted>
                      {metrics.applicationsSent}
                    </TD>
                    <TD label="Replied" num muted={metrics.tooEarly}>
                      {metrics.tooEarly ? 'too early' : formatRate(metrics.responseRate)}
                    </TD>
                    <TD label="Screened" num muted>
                      {metrics.tooEarly ? '—' : formatRate(metrics.screenRate)}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
          <p className="mt-2 text-small leading-relaxed text-ink-muted">
            A month is marked &ldquo;too early&rdquo; until its newest applications are{' '}
            {RESPONSE_WINDOW_DAYS} days old. Including them would drag every rate toward zero and
            make recent effort look like failure.
          </p>
        </CardSection>

        <CardSection
          title="Where rejections happen"
          hint="Rejection at resume review and rejection after a final round are opposite diagnoses leading to opposite responses. Without this split, every rejection looks the same."
        >
          {rejections.length === 0 ? (
            <p className="mt-3 text-ui text-ink-muted">No rejections recorded yet.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {rejections.map((entry) => {
                const total = rejections.reduce((sum, e) => sum + e.count, 0);
                const share = entry.count / total;
                return (
                  <li key={entry.stage}>
                    <div className="flex items-baseline justify-between gap-2 text-ui">
                      <span className="text-ink">{STAGE_LABELS[entry.stage] ?? entry.stage}</span>
                      <span className="tabular text-ink-muted">{entry.count}</span>
                    </div>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-canvas">
                      <div
                        className="h-full rounded-full bg-status-rejected"
                        style={{ width: `${Math.max(share * 100, 2)}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardSection>
      </div>
    </>
  );
}

