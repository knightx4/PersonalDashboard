import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/server';
import { createYouClient } from '@/lib/you/auth/server';
import { spriteFor } from '@/lib/you/advisor-avatar-draw';
import { ADVISOR_TABS, advisorHref, loadAdvisorProfile, type AdvisorTab } from '@/lib/you/board-profile';
import { ITEM_KEY } from '@/lib/you/board';
import { tabFrom } from '@/lib/tabs';
import { drawAdvisorAvatar, retryAdvisorBrain, saveAdvisorAvatar, setAdvisorActive } from '../../actions';
import { AdvisorAvatars } from '../../advisor-avatar';
import { ProfileView } from './profile-view';

export const metadata = { title: 'Advisor' };
export const dynamic = 'force-dynamic';

/** The time the page is read; outside the component, since reading the clock during render is unstable. */
function readAt(): number {
  return Date.now();
}

/**
 * One advisor's profile (plan #2581.5): how they think, what they have
 * forecast and how often they were right. Reached by pressing an advisor on
 * the roster, in a meeting's debate or on the track records.
 */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const { key } = await params;
  if (!ITEM_KEY.test(key)) notFound();
  const tab = tabFrom((await searchParams).tab, ADVISOR_TABS) as AdvisorTab;
  const user = await requireUser();
  const client = await createYouClient();
  const profile = await loadAdvisorProfile(client, user.id, key);
  if (!profile) notFound();
  const { advisor } = profile;
  return (
    <AdvisorAvatars {...spriteFor([{ key: advisor.key, avatar: advisor.avatar }])}>
      <ProfileView
        {...profile}
        tab={tab}
        now={readAt()}
        subject={{
          ref: null,
          path: [
            { label: 'You', href: '/you' },
            { label: 'Advisors', href: '/you/advisors' },
            { label: 'Roster', href: '/you/advisors/advisors' },
            { label: advisor.name, href: advisorHref(advisor.key) },
          ],
        }}
        actions={{
          retry: retryAdvisorBrain,
          setActive: setAdvisorActive,
          drawAvatar: drawAdvisorAvatar,
          saveAvatar: saveAdvisorAvatar,
        }}
      />
    </AdvisorAvatars>
  );
}
