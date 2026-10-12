import { createClient, requireUser } from '@/lib/auth/server';
import { loadCorrectionWeeks } from '@/lib/plan/correction-share-load';
import { loadRemovedTaste } from '@/lib/dev/taste-removals-load';
import { UiStandard } from './standard';

type Client = Awaited<ReturnType<typeof createClient>>;

/**
 * Each plan step's outline by number, from the plan_item_outlines view, so a
 * moment names the step that builds it the way the plan page heads the row.
 * A read that fails leaves the map empty, and the moments name the number.
 */
async function loadOutlines(supabase: Client, userId: string): Promise<Map<number, string>> {
  const index = new Map<number, string>();
  try {
    const { data, error } = await supabase
      .from('plan_item_outlines')
      .select('number, outline')
      .eq('user_id', userId);
    if (error) return index;
    for (const row of (data ?? []) as { number: number; outline: string | null }[]) {
      if (row.outline) index.set(Number(row.number), row.outline);
    }
  } catch {
    // Named by number instead.
  }
  return index;
}

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
  const [corrections, removedTaste, outlines] = await Promise.all([
    loadCorrectionWeeks(supabase, user.id),
    loadRemovedTaste(supabase, user.id),
    loadOutlines(supabase, user.id),
  ]);
  return <UiStandard corrections={corrections} removedTaste={removedTaste} outlines={outlines} />;
}
