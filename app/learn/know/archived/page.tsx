import { requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { createLearnClient } from '@/lib/learn/auth/server';
import { loadArchivedSubjects } from '@/lib/learn/archive';
import { ArchivedView } from './archived-view';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Archived subjects' };

/**
 * Learn's archived subjects (plan #2355.2): the list reached from the
 * Subjects list's Archived link, with Restore on each row. Loading shows
 * Learn's shared skeleton, as the Subjects list does.
 */
export default async function ArchivedSubjectsPage() {
  const user = await requireUser();
  const [learn, settings] = await Promise.all([createLearnClient(), loadAccountSettings(user.id)]);
  const subjects = await loadArchivedSubjects(learn, user.id);
  return <ArchivedView subjects={subjects} timezone={settings.timezone} now={new Date().getTime()} />;
}
