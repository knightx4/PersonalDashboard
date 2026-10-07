import { createClient, requireUser } from '@/lib/auth/server';
import { loadCorrectionWeeks } from '@/lib/plan/correction-share-load';
import { loadRemovedTaste } from '@/lib/dev/taste-removals-load';
import { UiStandard } from './standard';

export const metadata = { title: 'UI' };

export const dynamic = 'force-dynamic';

/**
 * The design standard (./standard.tsx), with the one section that reads the
 * record: how often the person's notes correct a screen a step changed in the
 * 30 days before (plan #1543), and the preferences the person removed (plan
 * #1547).
 */
export default async function DevUiPage() {
  const user = await requireUser();
  const supabase = await createClient();
  const [corrections, removedTaste] = await Promise.all([
    loadCorrectionWeeks(supabase, user.id),
    loadRemovedTaste(supabase, user.id),
  ]);
  return <UiStandard corrections={corrections} removedTaste={removedTaste} />;
}
