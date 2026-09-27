import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/shell/page-header';
import { createClient, requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { isOwner } from '@/lib/dev/owner';
import { switchableModules } from '@/lib/modules';
import { latestEventBefore, readTimeline } from '@/lib/timeline/load';
import { monthKeyOf } from '@/lib/timeline/months';
import { readObservations } from '@/lib/timeline/observations-load';
import { TIMELINE_MODULES } from '@/lib/timeline/timeline';
import { canWriteReview, currentYear, parseYear, yearTotals, yearWindow } from '@/lib/timeline/year-review';
import { readYearReview } from '@/lib/timeline/year-review-load';
import { showYearReview } from '@/lib/timeline/year-review-view';
import { YearReviewView } from './view';

// "Write the review" runs on this page: a year of the timeline and one
// Sonnet call, which can take most of a minute.
export const maxDuration = 120;

export async function generateMetadata({ params }: { params: Promise<{ year: string }> }) {
  const { year } = await params;
  return { title: `${year} in review` };
}

/**
 * The year in review (plan #1121): what Dash wrote about a year, and the
 * counts it wrote from, all read from the timeline. The review is stored when
 * it is written, so opening the page never calls the model; the year being
 * lived in can be written again from here, and a year that has ended is
 * written once.
 *
 * Any year up to the current one opens. A year with no review shows the
 * counts from the timeline as they stand, and says so when there is too
 * little to write about or nothing at all.
 */
export default async function YearReviewPage({ params }: { params: Promise<{ year: string }> }) {
  const user = await requireUser();
  const [{ year: raw }, settings, owner, client] = await Promise.all([
    params,
    loadAccountSettings(user.id),
    isOwner({ user }),
    // The request's own session: core.timeline is security_invoker and
    // core.year_reviews is read under RLS.
    createClient(),
  ]);

  const timezone = settings.timezone;
  const now = new Date();
  const current = currentYear(now, timezone);
  const year = parseYear(raw, current);
  if (year == null) notFound();

  const switchedOn = switchableModules(settings.enabledModules, owner);
  const modules = TIMELINE_MODULES.filter((id) => switchedOn.includes(id));
  const window = yearWindow(year, timezone);

  const [events, before, stored, noticed] = await Promise.all([
    modules.length === 0 ? [] : readTimeline(client, { from: window.from, to: window.to, modules }),
    modules.length === 0 ? null : latestEventBefore(client, window.from, modules),
    readYearReview(client, year),
    readObservations(client, { fromWeek: `${year}-01-01`, toWeek: `${year + 1}-01-01` }).catch(() => []),
  ]);

  const live = yearTotals(events, year, timezone, year < current ? `${year}-12` : monthKeyOf(now.toISOString(), timezone));
  const shown = showYearReview(stored, live, events);

  return (
    <>
      <PageHeader
        title={`${year} in review`}
        description="What the year held, counted from the timeline and written up by Dash."
        actions={
          <Link href="/timeline" className="text-ui text-accent hover:underline">
            Timeline
          </Link>
        }
      />
      <YearReviewView
        year={year}
        writable={canWriteReview(year, current, stored)}
        current={year === current}
        state={shown.state}
        totals={shown.totals}
        paragraphs={shown.paragraphs}
        observations={noticed}
        timezone={timezone}
        // Last year is always offered from this one, even with nothing in
        // it; further back, straight to the next year that has something.
        earlier={
          year === current ? year - 1 : before ? Number(monthKeyOf(before, timezone).slice(0, 4)) : null
        }
        later={year < current ? year + 1 : null}
      />
    </>
  );
}
