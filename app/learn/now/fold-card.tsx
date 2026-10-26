import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { FoldDetails } from '@/components/ui/fold-details';

/**
 * A card of rows that folds shut under its heading, with the count on the
 * closed line, kept in this browser under `remember` (plan #2546.4). Now
 * leads with Start, so everything else on the page folds; this is the shape
 * the due reviews already have (app/learn/review/review-list.tsx).
 */
export function FoldCard({
  title,
  count,
  remember,
  defaultOpen = false,
  id,
  children,
}: {
  title: string;
  count: number;
  remember: string;
  defaultOpen?: boolean;
  id?: string;
  children: ReactNode;
}) {
  return (
    <Card padding="none" id={id} className="mb-4 scroll-mt-4">
      <FoldDetails remember={remember} defaultOpen={defaultOpen} className="group/foldcard">
        <summary className="press card-pad-x block cursor-pointer list-none py-(--card-p) group-open/foldcard:pb-0 focus-visible:outline-2 focus-visible:-outline-offset-2 [&::-webkit-details-marker]:hidden">
          <h2 className="flex items-baseline gap-2 text-ui font-semibold text-ink">
            <ChevronRight
              aria-hidden
              strokeWidth={1.75}
              className="size-3.5 shrink-0 translate-y-0.5 text-ink-ghost transition-transform duration-quick group-open/foldcard:rotate-90"
            />
            {title}
            <span className="tabular font-normal text-ink-muted">({count})</span>
          </h2>
        </summary>
        {children}
      </FoldDetails>
    </Card>
  );
}
