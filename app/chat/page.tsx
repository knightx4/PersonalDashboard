import { requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { createYouClient } from '@/lib/you/auth/server';
import { loadCouncilHome } from '@/lib/you/council';
import type { Mentor } from '@/lib/you/council-model';
import { PeopleView } from './people-view';

export const metadata = { title: 'People' };
export const dynamic = 'force-dynamic';

/** The time the page is read; outside the component, since reading the clock during render is unstable. */
function readAt(): number {
  return Date.now();
}

/**
 * Chat's People tab (plan #2748.1), the page Chat opens on: the mentors on
 * your council, each opening their page on the Council until the People tab
 * draws their threads here (#2748.6).
 */
export default async function ChatPeoplePage() {
  const user = await requireUser();
  const client = await createYouClient();
  const now = readAt();
  const [home, settings] = await Promise.all([
    loadCouncilHome(client, user.id, now).then(
      (found): { mentors: Mentor[]; failed?: true } => ({ mentors: found.mentors }),
      (error: unknown) => {
        console.error('chat people were not read', error);
        return { mentors: [], failed: true as const };
      },
    ),
    loadAccountSettings(user.id),
  ]);
  return <PeopleView mentors={home.mentors} failed={home.failed} timezone={settings.timezone} now={now} />;
}
