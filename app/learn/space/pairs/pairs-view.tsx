import { Copy } from 'lucide-react';
import { ListPage, ListRow } from '@/components/patterns/list-detail';
import { PageColumn } from '@/components/shell/page-width';
import { PageHeader, type Subject } from '@/components/shell/page-header';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import {
  PAIRS_HREF,
  pairHref,
  similarityPercent,
  suggestedKeep,
  type IdeaPair,
} from '@/lib/learn/map/idea-pairs';

export const PAIRS_SUBJECT: Subject = {
  ref: null,
  path: [
    { label: 'Learn', href: '/learn' },
    { label: 'Know', href: '/learn/know' },
    { label: 'Idea Space', href: '/learn/space' },
    { label: 'Same idea twice', href: PAIRS_HREF },
  ],
};

/**
 * The same idea written in two subjects (plan #2147.2), in the
 * list-and-detail pattern: the header, one surface of pairs closest first,
 * then the count. Pressing a pair opens the two ideas side by side, where it
 * is merged or both are kept.
 *
 * Each row is named by the idea a merge would keep, then names the other
 * and the two subjects. `pairs` is null when they could not be read, which the page says
 * rather than drawing an empty list (law 2). The page and the gallery both
 * draw this, so it reads nothing itself.
 */
export function IdeaPairsView({ pairs }: { pairs: readonly IdeaPair[] | null }) {
  const header = (
    <PageHeader subject={PAIRS_SUBJECT} title="Same idea twice" />
  );

  if (!pairs) {
    return (
      <PageColumn>
        {header}
        <Card padding="standard">
          <p role="alert" className="text-body text-ink">
            Your ideas could not be read just now, so the pairs are missing. Reload to try again.
          </p>
        </Card>
      </PageColumn>
    );
  }

  if (pairs.length === 0) {
    return (
      <PageColumn>
        {header}
        <Card padding="none">
          <EmptyState
            icon={Copy}
            tone="finished"
            title="No idea is written twice"
            description="Ideas in two subjects that read as one idea are listed here to merge or keep. None are close enough now, or every pair found so far has been merged or kept."
            action={{ label: 'Back to Idea Space', href: '/learn/space' }}
          />
        </Card>
      </PageColumn>
    );
  }

  return (
    <ListPage
      header={header}
      foot={`${pairs.length} ${pairs.length === 1 ? 'pair' : 'pairs'} to settle`}
    >
      {pairs.map((pair) => {
        const keep = suggestedKeep(pair);
        const other = keep.id === pair.a.id ? pair.b : pair.a;
        return (
          <ListRow
            key={`${pair.a.id}:${pair.b.id}`}
            href={pairHref(pair.a.id, pair.b.id)}
            title={keep.name}
            meta={`and “${other.name}”, in ${keep.subject.name} and ${other.subject.name}`}
            end={`${similarityPercent(pair.similarity)} alike`}
          />
        );
      })}
    </ListPage>
  );
}
