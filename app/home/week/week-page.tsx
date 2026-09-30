import { createClient, requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { nextReviewDay } from '@/lib/week-review/view';
import { readWeekPage } from '@/lib/week-review/view-load';
import { WeekReviewView } from './view';

/**
 * The reads behind both Week routes (plan #1233): /home/week shows the
 * newest review and /home/week/<Sunday> the one for that week. Before any
 * review exists the page says when the first is written.
 */
export async function WeekPage({ week }: { week: string | null }) {
  const user = await requireUser();
  // The request's own session: core.week_reviews is read under RLS and
  // core.timeline is security_invoker.
  const [settings, client] = await Promise.all([loadAccountSettings(user.id), createClient()]);
  const { review, weeks } = await readWeekPage(client, week);

  if (review) return <WeekReviewView state="shown" review={review} weeks={weeks} timezone={settings.timezone} />;
  if (week && weeks.length > 0) return <WeekReviewView state="missing" week={week} weeks={weeks} />;
  return <WeekReviewView state="none" next={nextReviewDay(new Date())} />;
}
