import Link from 'next/link';
import { ArrowLeft, Layers } from 'lucide-react';
import { createClient, requireUser } from '@/lib/auth/server';
import { PageHeader } from '@/components/shell/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { Card } from '@/components/ui/card';
import { loadFamilySuggestions } from '@/lib/share/families-store';
import { FamilySuggestionCard } from './family-ui';

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

  return (
    <>
      <Link
        href="/shopping/share"
        className="mb-3 inline-flex items-center gap-1.5 text-[13px] text-ink-muted hover:text-ink"
      >
        <ArrowLeft className="size-3.5" aria-hidden /> Shared forms
      </Link>

      <PageHeader
        title="Grouping"
        description="Games that look like they belong together. Confirm one and the shared form puts them under a single heading."
      />

      {suggestions.length === 0 ? (
        <EmptyState
          icon={Layers}
          title="Nothing to group"
          description="Either everything is already grouped, or no two games on your shelf are named after each other."
        />
      ) : (
        <ul className="max-w-2xl space-y-3">
          {suggestions.map((family) => (
            <li key={family.slug}>
              <Card className="p-4">
                <FamilySuggestionCard family={family} />
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
