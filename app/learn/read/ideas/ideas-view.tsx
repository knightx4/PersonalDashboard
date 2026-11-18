import Link from '@/components/ui/link';
import { Lightbulb } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { PageColumn } from '@/components/shell/page-width';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { sectionSubject } from '@/lib/core/section-path';
import type { MetIdea } from '@/lib/learn/reader/shelves';

/**
 * What reading leaves behind (docs/LEARN-READER-SPEC.md): the one idea of
 * every section the person has read, each a way back to its passage. This is
 * what takes the place of a review queue. Nothing here is asked of them; they
 * come back to an idea when they want it.
 */
export function IdeasView({ ideas }: { ideas: MetIdea[] }) {
  return (
    <PageColumn className="space-y-5">
      <PageHeader
        subject={sectionSubject('/learn/read', 'Now', {
          label: 'Ideas you have met',
          href: '/learn/read/ideas',
        })}
        title="Ideas you have met"
      />
      {ideas.length === 0 ? (
        <EmptyState
          icon={Lightbulb}
          title="None yet"
          description="Each section you finish leaves its one idea here, with a way back to the passage it came from."
        />
      ) : (
        <Card padding="none">
          <ul className="divide-y divide-border">
            {ideas.map((idea) => (
              <li key={`${idea.sourceId}-${idea.section}`}>
                <Link
                  href={`/learn/read/${idea.sourceId}/${idea.section}`}
                  className="card-pad-x row-pad block min-h-11 transition-colors duration-quick hover:bg-sunken"
                >
                  <span className="block text-ui font-medium text-ink [overflow-wrap:anywhere]">
                    {idea.idea}
                  </span>
                  <span className="block text-small text-ink-muted [overflow-wrap:anywhere]">
                    {idea.source} · {idea.title}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </PageColumn>
  );
}
