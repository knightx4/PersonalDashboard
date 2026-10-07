import { createClient, requireUser } from '@/lib/auth/server';
import { loadFamilySuggestions } from '@/lib/share/families-store';
import { FamiliesView } from './families-view';

export const metadata = { title: 'Grouping' };

/**
 * Which things belong together, proposed and then decided.
 *
 * Nothing here groups anything on its own. "Ticket to Ride: Europe" is a
 * standalone game named after another one and no heuristic settles that, so
 * the machine proposes and a person answers -- once, permanently, including
 * when the answer is no.
 */
export default async function FamiliesPage() {
  const user = await requireUser();
  const supabase = await createClient();
  const suggestions = await loadFamilySuggestions(supabase, user.id);

  return <FamiliesView suggestions={suggestions} />;
}
