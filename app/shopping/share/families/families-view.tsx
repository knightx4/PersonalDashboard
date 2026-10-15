import { sectionSubject } from '@/lib/core/section-path';
import { Layers } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { Card } from '@/components/ui/card';
import type { PendingSuggestion } from '@/lib/share/families-store';
import { FamilySuggestionCard } from './family-ui';
import { PageColumn } from '@/components/shell/page-width';

/**
 * Grouping, drawn from what the page read (page.tsx), so the gallery can draw
 * it from fixtures (plan #1604).
 */
export function FamiliesView({ suggestions }: { suggestions: PendingSuggestion[] }) {
  return (
    <PageColumn className="[&_a]:press-area">
      <PageHeader
        subject={sectionSubject('/shopping/share', 'Shared forms', {
          label: 'Possible families',
          href: '/shopping/share/families',
        })}
        title="Possible families"
      />

      {suggestions.length === 0 ? (
        <EmptyState
          icon={Layers}
          title="Nothing to group"
          description="Games named after each other show up here, and confirming one puts them under a single heading on a shared form. Either everything is already grouped, or no two games on your shelf match."
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
      {suggestions.length > 0 && (
        <p className="mt-3 text-small text-ink-muted">
          {suggestions.length} {suggestions.length === 1 ? 'suggestion' : 'suggestions'}
        </p>
      )}
    </PageColumn>
  );
}
