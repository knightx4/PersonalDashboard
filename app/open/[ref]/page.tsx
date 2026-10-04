import { redirect } from 'next/navigation';
import { requestAskDb } from '@/lib/ask/clients';
import { requireUser } from '@/lib/auth/server';
import { readRowsWith, refTitles } from '@/lib/core/refs';
import { NoLongerThere } from './no-longer-there';

export const metadata = { title: 'Open' };

/**
 * A ref opened by name (plan #1449): reads the row on the person's session
 * and goes on to its page. A row that has gone, or is not theirs, is shown as
 * no longer there, and links nowhere.
 */
export default async function OpenRefPage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref: encoded } = await params;
  await requireUser();
  const ref = decodeURIComponent(encoded);
  const target = (await refTitles([ref], readRowsWith(requestAskDb()))).get(ref);
  if (target && !target.missing && target.href) redirect(target.href);

  return <NoLongerThere />;
}
