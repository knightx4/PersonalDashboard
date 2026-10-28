import { requireUser } from '@/lib/auth/server';
import { FinancesSettingsView } from './settings-view';

export const metadata = { title: 'Finances settings' };

/** The accounts Finances reads (plan #2593.1); the Plaid link step fills it. */
export default async function FinancesSettingsPage() {
  await requireUser();
  return <FinancesSettingsView />;
}
