import { requireUser } from '@/lib/auth/server';
import { createGoalsClient } from '@/lib/goals/auth/server';
import { loadGoalSettings } from '@/lib/goals/settings-store';
import { GoalsSettingsView } from './settings-view';

export const metadata = { title: 'Goals settings' };
export const dynamic = 'force-dynamic';

/** Goals settings, at the foot of the Goals column (plan #1937.10). */
export default async function GoalsSettingsPage() {
  const user = await requireUser();
  const settings = await loadGoalSettings(await createGoalsClient(), user.id);
  return <GoalsSettingsView settings={settings} />;
}
