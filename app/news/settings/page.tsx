import { requireUser } from '@/lib/auth/server';
import { newsAddress, newsDomainOrNull } from '@/lib/news/address';
import { createNewsClient } from '@/lib/news/auth/server';
import { deliveryGap } from '@/lib/news/inbound/readiness';
import { loadHiddenTopics } from '@/lib/news/quick/hidden-topics';
import { loadOrCreateLocalPart } from '@/lib/news/settings/address';
import { loadLocalArea } from '@/lib/news/settings/local-area';
import { NewsSettingsView } from './settings-view';

export const metadata = { title: 'News settings' };
export const dynamic = 'force-dynamic';

/**
 * The address, and the topics Quick read shows (plan #861, note ee75aef9).
 *
 * Opening this page for the first time is what creates the address -- there
 * is no button to press before the workspace works, and nothing to seed by
 * hand.
 */
export default async function NewsSettingsPage() {
  const user = await requireUser();
  const client = await createNewsClient();
  const [localPart, hidden, localArea] = await Promise.all([
    loadOrCreateLocalPart(client, user.id),
    loadHiddenTopics(client),
    loadLocalArea(client),
  ]);
  const domain = newsDomainOrNull();
  const address = domain ? newsAddress(localPart, domain) : null;

  return (
    <NewsSettingsView address={address} gap={deliveryGap()} hidden={hidden} localArea={localArea} />
  );
}
