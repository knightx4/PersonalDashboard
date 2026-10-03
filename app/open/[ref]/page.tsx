import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/shell/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { requestAskDb } from '@/lib/ask/clients';
import { requireUser } from '@/lib/auth/server';
import { NO_LONGER_THERE, readRowsWith, refTitles } from '@/lib/core/refs';

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

  return (
    <>
      <PageHeader title="Not found" />
      <EmptyState
        title={`This is ${NO_LONGER_THERE}`}
        description="The row this link named has been deleted, or has no page to open."
        action={{ label: 'Home', href: '/' }}
      />
    </>
  );
}
