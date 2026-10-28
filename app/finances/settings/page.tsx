import { createClient, requireUser } from '@/lib/auth/server';
import { FINANCES_SCHEMA } from '@/lib/finances/db/schema-name';
import { isPlaidConfigured } from '@/lib/finances/plaid/env';
import { FinancesSettingsView } from './settings-view';
import type { LinkedInstitution } from './linked-accounts';

export const metadata = { title: 'Finances settings' };

/** The institutions linked through Plaid and their accounts (plan #2593.3). */
export default async function FinancesSettingsPage() {
  const user = await requireUser();
  const supabase = await createClient();
  const db = supabase.schema(FINANCES_SCHEMA);

  // The signed-in person's client reads every column of a link but the token.
  const [{ data: links }, { data: accounts }] = await Promise.all([
    db
      .from('links')
      .select('id, institution_id, institution_name, status, needs_update, last_error, last_synced_at, created_at')
      .eq('user_id', user.id)
      .order('created_at'),
    db
      .from('accounts')
      .select('link_id, name, mask, kind')
      .eq('user_id', user.id)
      .not('link_id', 'is', null)
      .order('kind')
      .order('name'),
  ]);

  const rows = (links ?? []) as {
    id: string;
    institution_id: string | null;
    institution_name: string;
    status: string;
    needs_update: boolean;
    last_error: string | null;
    last_synced_at: string | null;
    created_at: string;
  }[];
  const byLink = new Map<string, { name: string; mask: string | null }[]>();
  for (const a of (accounts ?? []) as { link_id: string; name: string; mask: string | null }[]) {
    byLink.set(a.link_id, [...(byLink.get(a.link_id) ?? []), { name: a.name, mask: a.mask }]);
  }

  const listed: LinkedInstitution[] = rows
    .filter((l) => l.status !== 'removed')
    .map((l) => ({
      id: l.id,
      institutionId: l.institution_id,
      institutionName: l.institution_name,
      needsUpdate: l.needs_update,
      lastError: l.last_error,
      linkedAt: l.created_at,
      lastSyncedAt: l.last_synced_at,
      accounts: byLink.get(l.id) ?? [],
    }));

  return <FinancesSettingsView links={listed} itemsUsed={rows.length} configured={isPlaidConfigured()} />;
}
