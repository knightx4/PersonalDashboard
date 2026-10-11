import Link from 'next/link';
import { Share2 } from 'lucide-react';
import { ListPage } from '@/components/patterns/list-detail';
import { PageHeader } from '@/components/shell/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { NewShareButton } from './share-ui';

/** One share as the list reads it, with only the counts it shows. */
export type ShareListRow = {
  id: string;
  title: string;
  status: string;
  share_link_items: { id: string }[] | null;
  share_link_responses: { id: string }[] | null;
  share_link_tokens: { id: string; revoked_at: string | null; last_seen_at: string | null }[] | null;
};

/** The line under a form's title: what is on it, what came back, its links. */
function subline(share: ShareListRow): string {
  const items = (share.share_link_items ?? []).length;
  const answers = (share.share_link_responses ?? []).length;
  const live = (share.share_link_tokens ?? []).filter((t) => !t.revoked_at);
  const parts = [`${items} ${items === 1 ? 'item' : 'items'}`, `${answers} answered`];
  if (share.status !== 'active') parts.push('archived');
  else if (live.length === 0) parts.push('no live link');
  else if (live.some((t) => t.last_seen_at)) parts.push('opened');
  else parts.push('not opened yet');
  return parts.join(' · ');
}

/**
 * The shared forms I have made, drawn from what the page read (page.tsx), so
 * the gallery can draw it from fixtures (plan #1604).
 *
 * The list-and-detail pattern (plan #1789): the header with its one action,
 * New form, which opens the name box; one surface of rows, active forms
 * before archived ones; then the count. Grouping is a quiet link beside the
 * action. What a shared form is for is said by the empty state, not under
 * the heading.
 */
export function SharesView({ rows }: { rows: ShareListRow[] }) {
  const active = rows.filter((s) => s.status === 'active');
  const archived = rows.filter((s) => s.status !== 'active');

  const header = (
    <PageHeader
      title="Shared forms"
      actions={
        <div className="flex items-center gap-4">
          <Link
            href="/shopping/share/families"
            className="text-ui font-medium text-accent hover:underline"
          >
            Grouping
          </Link>
          <NewShareButton />
        </div>
      }
    />
  );

  if (rows.length === 0) {
    return (
      <div className="mx-auto max-w-3xl [&_a]:press-area">
        {header}
        <EmptyState
          icon={Share2}
          title="Nothing shared yet"
          description="A shared form is a list someone can open and fill in without an account, and their answers land here. Make one with New form, put things on it from your inventory, then send the link."
          action={{ label: 'Open inventory', href: '/shopping/inventory' }}
        />
      </div>
    );
  }

  return (
    <ListPage
      className="[&_a]:press-area"
      header={header}
      foot={`${rows.length} ${rows.length === 1 ? 'form' : 'forms'}${
        archived.length > 0 ? `, ${archived.length} archived` : ''
      }`}
    >
      {[...active, ...archived].map((share) => (
        <li key={share.id}>
          <Link
            href={`/shopping/share/${share.id}`}
            className="card-pad-x row-pad flex min-h-11 flex-col justify-center transition-colors duration-quick hover:bg-sunken"
          >
            <span className="text-ui text-ink">{share.title}</span>
            <span className="text-small text-ink-muted">{subline(share)}</span>
          </Link>
        </li>
      ))}
    </ListPage>
  );
}
