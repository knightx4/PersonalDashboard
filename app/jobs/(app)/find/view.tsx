import type { ComponentProps } from 'react';
import type { OpenSuggestion } from '@/lib/jobs/suggest/load';
import { RecommendedPeople, RecommendedRoles } from './sections';
import { SearchAim } from './aim';
import { DiscoveredCompanies } from './companies';

/**
 * The Find tab below its header, drawn from what the page loaded so the
 * gallery can draw it from fixtures (surface `jobs-find`).
 *
 * In reading order: what the search aims at, the roles Dash found against
 * it, the startups behind some of them, and the people to meet. Every panel takes the page's full
 * width, so their right edges line up (law 18). The anchors are where the phone
 * notification for a search opens (lib/jobs/suggest/notify.ts).
 */
export function FindView({
  aim,
  roles,
  companies,
  people,
}: {
  aim: ComponentProps<typeof SearchAim>;
  roles: ComponentProps<typeof RecommendedRoles>;
  companies: ComponentProps<typeof DiscoveredCompanies>;
  people: OpenSuggestion[];
}) {
  return (
    <div className="space-y-6">
      <SearchAim {...aim} />

      <div id="roles" className="scroll-mt-4">
        <RecommendedRoles {...roles} />
      </div>

      <div id="companies" className="scroll-mt-4">
        <DiscoveredCompanies {...companies} />
      </div>

      <div id="people" className="scroll-mt-4">
        <RecommendedPeople suggestions={people} />
      </div>
    </div>
  );
}
