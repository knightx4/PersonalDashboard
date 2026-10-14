import { requireUser } from '@/lib/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import { loadTeachBackEvery } from '@/lib/learn/feed/teach-back-store';
import { loadOfferSubjects } from '@/lib/learn/offer-setting';
import { LearnSettingsView } from './settings-view';

export const metadata = { title: 'Learn settings' };
export const dynamic = 'force-dynamic';

/** Learn settings, at the foot of the Learn column (plan #1937.10). */
export default async function LearnSettingsPage() {
  const user = await requireUser();
  const learn = await createLearnClient();
  const [offerSubjects, teachBackEvery] = await Promise.all([
    loadOfferSubjects(learn, user.id),
    loadTeachBackEvery(learn, user.id),
  ]);
  return <LearnSettingsView settings={{ offerSubjects, teachBackEvery }} />;
}
