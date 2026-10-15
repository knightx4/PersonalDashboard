import Link from '@/components/ui/link';
import { Card } from '@/components/ui/card';
import { Stat } from '@/components/ui/stat';
import {
  SENT_WINDOW_DAYS,
  sentHref,
  stageHref,
  type SearchSummary,
} from '@/lib/jobs/home/summary';
import { PIPELINE_PATH } from '@/lib/jobs/pipeline-view';
import { HomeSection } from './home-section';

/**
 * The numbers that say where the search stands, at the top of Today (plan
 * #1151, #1591; note 9aab04c4).
 *
 * The numbers each open the applications they counted: Live opens Pipeline,
 * which opens on the live ones; a stage opens the table narrowed to it; sent
 * opens the table narrowed to what was sent in the window, closed or not. The
 * interviews coming up are not counted here: This week, under the strip,
 * lists them, and the count made the row wrap beside the rail (plan #1937.9).
 *
 * The section used to list every live application under the strip, grouped
 * by whose move it is. Pipeline lists the same applications, so the strip is
 * all that stays here.
 */
export function LiveSection({ summary }: { summary: SearchSummary }) {
  // Each label has a short form for a phone, where the numbers have to fit
  // rows of four without a label wrapping.
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
  ];

  return (
    <HomeSection
      id="live"
      title="Live applications"
      more={{ href: PIPELINE_PATH, label: 'Open Pipeline' }}
    >
      <Card padding="standard">
        <div className="grid grid-cols-4 gap-x-2 gap-y-3 sm:flex sm:flex-wrap sm:gap-x-8">
          {stats.map((stat) => (
            <Link
              key={stat.label}
              href={stat.href}
              className="press-area min-w-0 whitespace-nowrap transition-colors duration-quick hover:[&_p:first-child]:text-accent"
            >
              <Stat
                size="sm"
                value={stat.value}
                label={
                  <>
                    <span className="sm:hidden" aria-hidden={stat.short !== stat.label || undefined}>
                      {stat.short}
                    </span>
                    {stat.short !== stat.label && <span className="max-sm:sr-only">{stat.label}</span>}
                    {stat.short === stat.label && <span className="max-sm:hidden">{stat.label}</span>}
                  </>
                }
              />
            </Link>
          ))}
        </div>
      </Card>
    </HomeSection>
  );
}
