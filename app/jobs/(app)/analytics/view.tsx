import { cn } from '@/lib/cn';
import { CardSection } from '@/components/ui/card';
import { Figure } from '@/components/ui/figure';
import { Meter } from '@/components/ui/meter';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import {
  CHANNEL_MIN_SENT,
  RESPONSE_WINDOW_DAYS,
  SOURCE_LABELS,
  advanceRate,
  channelStages,
  countReaching,
  formatDays,
  formatRate,
  funnelMetrics,
  monthlyCohorts,
  rejectionsByChannel,
  type ApplicationStatus,
  type FunnelApplication,
} from '@/lib/jobs/pipeline';

/**
 * The analytics page's body, drawn from the funnel rows alone so the gallery
 * can draw it with fixtures (surface `jobs-insights`).
 *
 * Every number on it comes from lib/jobs/pipeline.ts. Nothing is computed
 * inline here: a lint rule blocks the shape, because a rate with a quietly
 * wrong denominator looks exactly like a rate with a right one.
 */

const LADDER: Array<{ stage: ApplicationStatus; label: string }> = [
  { stage: 'submitted', label: 'Sent' },
  { stage: 'acknowledged', label: 'Acknowledged' },
  { stage: 'in_process', label: 'Screener interview' },
  { stage: 'final_round', label: 'Final round' },
  { stage: 'offer', label: 'Offer' },
];

const LADDER_LABEL = Object.fromEntries(LADDER.map((rung) => [rung.stage, rung.label])) as Record<
  ApplicationStatus,
  string
>;

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

const MONTH_HEAD =
  'row-pad px-2 text-left text-micro font-semibold uppercase tracking-wider text-ink-muted first:pl-0 last:pr-0';
const MONTH_CELL = 'row-pad px-2 align-top first:pl-0 last:pr-0';
const MONTH_NUM = 'tabular whitespace-nowrap text-right';

export function AnalyticsView({
  applications,
  now,
}: {
  applications: readonly FunnelApplication[];
  /** Fixed in the gallery so the "too early" months do not move. */
  now?: Date;
}) {
  const overall = funnelMetrics(applications, { now });
  const channels = channelStages(applications);
  const comparable = channels.filter((channel) => channel.enough).length;
  const cohorts = monthlyCohorts(applications, { now });
  const rejections = rejectionsByChannel(applications);
  const reached = (stage: ApplicationStatus) => countReaching(applications, stage);

  return (
    <>
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

      <CardSection
        className="mb-4"
        title="How far each channel got"
        hint="Each stage counts every application that ever reached it, with the share that moved on from the stage before."
      >
        <div className="mt-3">
          <Table flush>
            <THead>
              <TR>
                <TH>Channel</TH>
                {LADDER.map((rung) => (
                  <TH key={rung.stage} num>
                    {rung.label}
                  </TH>
                ))}
                <TH num>Quiet after interview</TH>
                <TH num>No answer</TH>
              </TR>
            </THead>
            <TBody>
              {channels.map((channel) => (
                <TR key={channel.source}>
                  <TD primary>
                    {SOURCE_LABELS[channel.source]}
                    {!channel.enough && (
                      <span className="block whitespace-nowrap text-small font-normal text-ink-muted">
                        Too few to compare
                      </span>
                    )}
                  </TD>
                  {channel.stages.map((entry) => (
                    <TD key={entry.stage} label={LADDER_LABEL[entry.stage]} num>
                      {/* One span, so the stacked phone row keeps the count
                          beside its share instead of splitting them apart. */}
                      <span>
                        {entry.count}
                        {entry.movedOn !== null && (
                          <span className="ml-2 text-ink-muted">{formatRate(entry.movedOn)}</span>
                        )}
                      </span>
                    </TD>
                  ))}
                  <TD label="Quiet after interview" num>
                    {channel.quietAfterInterview}
                  </TD>
                  <TD label="No answer" num muted>
                    {channel.noAnswer}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
        <p className="mt-2 text-small leading-relaxed text-ink-muted">
          {comparable < 2
            ? channels.length < 2
              ? 'Every application so far came through one channel, so there is no other channel to set these numbers beside yet.'
              : `Only one channel has ${CHANNEL_MIN_SENT} or more applications sent, so the others are shown but not yet worth comparing.`
            : `A channel with fewer than ${CHANNEL_MIN_SENT} sent is shown but marked, since one reply moves its shares a long way.`}{' '}
          Quiet after interview counts applications that went silent after at least one interview;
          no answer counts those that went silent with no reply from a person.
        </p>
      </CardSection>

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
                  <Meter
                    value={count}
                    max={overall.applicationsSent}
                    height="md"
                    minFraction={0.02}
                    className="mt-1"
                    label={`${rung.label}: ${count} of ${overall.applicationsSent} applications`}
                  />
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
          title="Where rejections happen"
          hint="Rejection at resume review and rejection after a final round call for opposite responses, so each channel's rejections are split by the stage they came at."
        >
          {rejections.length === 0 ? (
            <p className="mt-3 text-ui text-ink-muted">No rejections recorded yet.</p>
          ) : (
            <div className="mt-3 space-y-5">
              {rejections.map((channel) => (
                <section key={channel.source}>
                  <h3 className="flex items-baseline justify-between gap-2 text-ui font-medium text-ink">
                    <span>{SOURCE_LABELS[channel.source]}</span>
                    <span className="tabular font-normal text-ink-muted">
                      {channel.total} rejected
                    </span>
                  </h3>
                  <ul className="mt-2 space-y-2">
                    {channel.stages.map((entry) => (
                      <li key={entry.stage}>
                        <div className="flex items-baseline justify-between gap-2 text-ui">
                          <span className="text-ink">{STAGE_LABELS[entry.stage] ?? entry.stage}</span>
                          <span className="tabular text-ink-muted">{entry.count}</span>
                        </div>
                        <Meter
                          value={entry.count}
                          max={channel.total}
                          fill="bg-status-rejected"
                          height="md"
                          minFraction={0.02}
                          className="mt-1"
                          label={`${SOURCE_LABELS[channel.source]}, ${STAGE_LABELS[entry.stage] ?? entry.stage}: ${entry.count} of ${channel.total} rejections`}
                        />
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </CardSection>

        <CardSection
          className="lg:col-span-2"
          title="By month applied"
          hint="Cohorted by submission date, always. Applications sent in June stay the June cohort forever and their response rate fills in as replies arrive."
        >
          {/* Four short columns fit a phone, so this stays one row per month
              there. The shared Table either stacks each row or fades its
              right edge below lg, and neither suits four columns that fit. */}
          <table className="mt-3 w-full border-collapse text-ui">
            <thead>
              <tr>
                <th scope="col" className={MONTH_HEAD}>
                  Month
                </th>
                <th scope="col" className={cn(MONTH_HEAD, 'text-right')}>
                  Sent
                </th>
                <th scope="col" className={cn(MONTH_HEAD, 'text-right')}>
                  Replied
                </th>
                <th scope="col" className={cn(MONTH_HEAD, 'text-right')}>
                  Screened
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {cohorts.map(({ period, metrics }) => (
                <tr key={period.label}>
                  <td className={cn(MONTH_CELL, 'tabular font-medium text-ink')}>{period.label}</td>
                  <td className={cn(MONTH_CELL, MONTH_NUM, 'text-ink-muted')}>
                    {metrics.applicationsSent}
                  </td>
                  <td
                    className={cn(MONTH_CELL, MONTH_NUM, metrics.tooEarly ? 'text-ink-muted' : 'text-ink')}
                  >
                    {metrics.tooEarly ? 'too early' : formatRate(metrics.responseRate)}
                  </td>
                  <td className={cn(MONTH_CELL, MONTH_NUM, 'text-ink-muted')}>
                    {metrics.tooEarly ? '—' : formatRate(metrics.screenRate)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-small leading-relaxed text-ink-muted">
            A month is marked &ldquo;too early&rdquo; until its newest applications are{' '}
            {RESPONSE_WINDOW_DAYS} days old. Including them would drag every rate toward zero and
            make recent effort look like failure.
          </p>
        </CardSection>
      </div>
    </>
  );
}
