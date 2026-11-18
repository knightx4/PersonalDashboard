import { getUser } from '@/lib/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { loadLookupCaps } from '@/lib/dash/lookup-caps';
import { LookupCapsScreen } from './lookups-view';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Ran out of lookups' };

/**
 * The Ask Dash answers that used all their lookups (plan #3092), newest
 * first. The Dev layout has already refused anybody but the owner; the read
 * goes through the request's own client, so RLS keeps it to the signed-in
 * person.
 */
export default async function DevLookupCapsPage() {
  const user = await getUser();
  const [settings, entries] = await Promise.all([
    user ? loadAccountSettings(user.id) : Promise.resolve({ timezone: 'UTC' }),
    user
      ? createCoreClient()
          .then((core) => loadLookupCaps(core, user.id))
          .catch(() => null)
      : Promise.resolve([]),
  ]);
  return <LookupCapsScreen entries={entries} timeZone={settings.timezone} now={new Date()} />;
}
