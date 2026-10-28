import { redirect } from 'next/navigation';

/** Finances opens on Accounts, its first tab (plan #2593.6). */
export default function FinancesPage() {
  redirect('/finances/accounts');
}
