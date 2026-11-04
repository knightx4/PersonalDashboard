import { requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { createYouClient } from '@/lib/you/auth/server';
import { loadCouncilHome } from '@/lib/you/council';
import { listOpenReviews } from '@/lib/you/board-reviews';
import { listDueTripwires } from '@/lib/you/board-tripwires';
import { loadAvatarSprite } from '@/lib/you/advisor-avatar-draw';
import { AdvisorAvatars } from './advisor-avatar';
import { CouncilView } from './council-view';

export const metadata = { title: 'Council' };
export const dynamic = 'force-dynamic';

/** The time the page is read; outside the component, since reading the clock during render is unstable. */
function readAt(): number {
  return Date.now();
}

/**
 * You's Council tab (you 0037), the tab that was the Board: a line to the
 * mentors' texts in Chat (plan #2748.7), and every mentor as a tile that
 * opens their page.
 * The board's decisions and meetings are one press away, on Decisions.
 */
export default async function Page() {
  const user = await requireUser();
  const client = await createYouClient();
  const now = readAt();
  const [home, reviews, tripwires, settings, avatars] = await Promise.all([
    loadCouncilHome(client, user.id, now),
    listOpenReviews(client, user.id),
    listDueTripwires(client, user.id),
    loadAccountSettings(user.id),
    loadAvatarSprite(client, user.id),
  ]);
  return (
    <AdvisorAvatars {...avatars}>
      <CouncilView
        mentors={home.mentors}
        unreadTexts={home.unreadTexts}
        due={reviews.length + tripwires.length}
        timezone={settings.timezone}
        now={now}
      />
    </AdvisorAvatars>
  );
}
