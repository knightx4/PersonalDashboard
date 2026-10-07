import Link from 'next/link';
import { Link2, Share2 } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { cardVariants } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import { CreateShareForm } from './share-ui';

/** One share as the list reads it, with only the counts it shows. */
export type ShareListRow = {
  id: string;
  title: string;
  status: string;
  share_link_items: { id: string }[] | null;
  share_link_responses: { id: string }[] | null;
  share_link_tokens: { id: string; revoked_at: string | null; last_seen_at: string | null }[] | null;
};

/**
 * The shared forms I have made, drawn from what the page read (page.tsx), so
 * the gallery can draw it from fixtures (plan #1604).
 */
export function SharesView({ rows }: { rows: ShareListRow[] }) {
  const active = rows.filter((s) => s.status === 'active');
  const archived = rows.filter((s) => s.status !== 'active');

  return (
    <div className="[&_a]:press-area max-sm:[&_input]:min-h-11 max-sm:[&_textarea]:min-h-11">
      <PageHeader
        title="Shared forms"
        description="A list someone can open and fill in without an account. Their answers land here."
        actions={
          <Link
            href="/shopping/share/families"
            className="text-ui font-medium text-accent hover:underline"
          >
            Grouping
          </Link>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div>
          {active.length === 0 && archived.length === 0 ? (
            <EmptyState
              icon={Share2}
              title="Nothing shared yet"
              description="Make a form, put things on it from your inventory, then send the link."
              // The composer is beside this on a wide screen and below it on a
              // phone; either way the first step is the same box.
              action={{ label: 'Make a form', href: '#new-share' }}
              secondaryAction={{ label: 'Open inventory', href: '/shopping/inventory' }}
            />
          ) : (
            <ul className="space-y-3">
              {[...active, ...archived].map((share) => {
                const items = (share.share_link_items ?? []).length;
                const answers = (share.share_link_responses ?? []).length;
                const live = (share.share_link_tokens ?? []).filter((t) => !t.revoked_at);
                const seen = live.some((t) => t.last_seen_at);

                return (
                  <li key={share.id}>
                    <Link
                      href={`/shopping/share/${share.id}`}
                      className={cn(cardVariants({ padding: 'dense', interactive: true }), 'block')}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-body font-medium text-ink">{share.title}</p>
                          <p className="mt-0.5 text-ui text-ink-muted">
                            {items} {items === 1 ? 'item' : 'items'} · {answers} answered
                            {share.status !== 'active' && ' · archived'}
                          </p>
                        </div>
                        <span className="flex shrink-0 items-center gap-1 text-small text-ink-muted">
                          <Link2 className="size-3.5" strokeWidth={1.75} aria-hidden />
                          {live.length} live
                          {seen && ' · opened'}
                        </span>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <CreateShareForm />
      </div>
    </div>
  );
}
