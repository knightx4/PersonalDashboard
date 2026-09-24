import { PageHeader } from '@/components/shell/page-header';
import { requireUser } from '@/lib/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import { loadActiveAims } from '@/lib/learn/aims-store';
import type { Aim } from '@/lib/learn/aims';
import { GoalsView } from './goals-view';

export const dynamic = 'force-dynamic';

/**
 * The things you want to learn and how well (plan #895, this page is #897).
 *
 * The page says Goals; the code and the table say aims, because `goals`
 * already means a concept typed into a track. Learn now reads these to bring
 * cards towards them (#900).
 */
export default async function GoalsPage() {
  await requireUser();
  const supabase = await createLearnClient();

  // A failed read becomes a line where the list would be, not a broken page.
  let aims: Aim[] | null = null;
  try {
    aims = await loadActiveAims(supabase);
  } catch {
    aims = null;
  }

  return (
    <>
      <PageHeader
        title="Goals"
        description="A few broad things you want to learn, and how well. Learn now brings you cards towards them."
      />
      {aims ? (
        <GoalsView aims={aims} />
      ) : (
        <p className="text-ui text-ink-muted">Your goals could not be read. Reload to try again.</p>
      )}
    </>
  );
}
