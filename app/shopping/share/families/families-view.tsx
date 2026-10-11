import Link from 'next/link';
import { ArrowLeft, Layers } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { Card } from '@/components/ui/card';
import type { PendingSuggestion } from '@/lib/share/families-store';
import { FamilySuggestionCard } from './family-ui';

/**
 * Grouping, drawn from what the page read (page.tsx), so the gallery can draw
 * it from fixtures (plan #1604).
 */
export function FamiliesView({ suggestions }: { suggestions: PendingSuggestion[] }) {
  return (
    <div className="[&_a]:press-area">
      <Link
        href="/shopping/share"
        className="mb-3 inline-flex items-center gap-1.5 text-ui text-ink-muted transition-colors duration-quick hover:text-ink"
      >
        <ArrowLeft className="size-3.5" strokeWidth={1.75} aria-hidden /> Shared forms
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
          action={{ label: 'Open inventory', href: '/shopping/inventory' }}
          secondaryAction={{ label: 'Shared forms', href: '/shopping/share' }}
        />
      ) : (
        /* One surface, hairlines between (law 13). A card per suggestion gave
         * each row its own border and margin in a list that is scrolled. */
        <Card padding="none" className="max-w-2xl">
          <ul className="divide-y divide-border">
            {suggestions.map((family) => (
              <li key={family.slug} className="card-pad-x row-pad">
                <FamilySuggestionCard family={family} />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
