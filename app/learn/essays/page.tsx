import { createLearnClient } from '@/lib/learn/auth/server';
import { loadEssays } from '@/lib/learn/essays/store';
import { EssaysView } from './essays-view';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Essays' };

/** Your essays; essays-view.tsx says how they are drawn (plan #1865). */
export default async function EssaysPage() {
  const supabase = await createLearnClient();
  const essays = await loadEssays(supabase);
  return <EssaysView essays={essays} />;
}
