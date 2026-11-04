import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { createYouClient } from '@/lib/you/auth/server';
import { spriteFor } from '@/lib/you/advisor-avatar-draw';
import { ADVISOR_TABS, advisorHref, loadAdvisorProfile, type AdvisorTab } from '@/lib/you/board-profile';
import { ITEM_KEY } from '@/lib/you/board';
import { tabFrom } from '@/lib/tabs';
import { drawAdvisorAvatar, retryAdvisorBrain, saveAdvisorAvatar, setAdvisorActive } from '../../actions';
import { AdvisorAvatars } from '../../advisor-avatar';
import { AdvisorTalkSkeleton } from './talk-skeleton';
import { ProfileView } from './profile-view';
import { TalkSection } from './talk-section';

export const metadata = { title: 'Advisor' };
export const dynamic = 'force-dynamic';

/** The time the page is read; outside the component, since reading the clock during render is unstable. */
function readAt(): number {
  return Date.now();
}

/**
 * One advisor's profile (plan #2581.5): how they think, what they have
 * forecast and how often they were right, and a one-on-one talk with them
 * (plan #2581.6), whose rows load inside the tab while the header shows. Reached by pressing an advisor on
 * the roster, in a meeting's debate or on the track records.
 */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<{ tab?: string | string[]; chat?: string | string[] }>;
}) {
  const { key } = await params;
  if (!ITEM_KEY.test(key)) notFound();
  const query = await searchParams;
  const tab = tabFrom(query.tab, ADVISOR_TABS) as AdvisorTab;
  const chat = typeof query.chat === 'string' && /^(new|[0-9a-f-]{36})$/.test(query.chat) ? query.chat : null;
  const user = await requireUser();
  const client = await createYouClient();
  const profile = await loadAdvisorProfile(client, user.id, key);
  if (!profile) notFound();
  const { advisor } = profile;
  const timeZone = tab === 'talk' ? (await loadAccountSettings(user.id)).timezone : 'UTC';
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
            { label: 'Council', href: '/you/council' },
            { label: 'Mentors', href: '/you/council/advisors' },
            { label: advisor.name, href: advisorHref(advisor.key) },
          ],
        }}
        talk={
          tab === 'talk' ? (
            <Suspense key={chat ?? 'latest'} fallback={<AdvisorTalkSkeleton />}>
              <TalkSection userId={user.id} advisor={advisor} brain={profile.brain} chat={chat} timeZone={timeZone} />
            </Suspense>
          ) : null
        }
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
