import { redirect } from 'next/navigation';

/** Finances opens on Spending, its first tab (plan #2593.1). */
export default function FinancesPage() {
  redirect('/finances/spending');
}
