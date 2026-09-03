import Link from 'next/link';
import { Link2, Share2 } from 'lucide-react';
import { createClient, requireUser } from '@/lib/auth/server';
import { PageHeader } from '@/components/shell/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { Card } from '@/components/ui/card';
import { CreateShareForm } from './share-ui';

export const metadata = { title: 'Shared forms' };

/**
 * The shares I have made.
 *
 * A share is a list of things plus a link someone with no account can open.
 * The answers come back here; nothing she does changes the inventory on its
 * own. See docs/SHARE-LINKS-SPEC.md.
 */
export default async function SharesPage() {
  const user = await requireUser();
  const supabase = await createClient();

  const { data: shares } = await supabase
    .from('share_links')
    .select(
      `
      id, title, intro, status, created_at,
      share_link_items ( id ),
      share_link_responses ( id ),
      share_link_tokens ( id, revoked_at, last_seen_at )
    `,
    )
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  const rows = shares ?? [];
  const active = rows.filter((s) => s.status === 'active');
  const archived = rows.filter((s) => s.status !== 'active');

  return (
    <>
      <PageHeader
        title="Shared forms"
        description="A list someone can open and fill in without an account. Their answers land here."
        actions={
          <Link
            href="/shopping/share/families"
            className="text-[13px] text-ink-muted hover:text-ink"
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
                    <Link href={`/shopping/share/${share.id}`} className="block">
                      <Card interactive className="p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-ink">{share.title}</p>
                            <p className="mt-0.5 text-[13px] text-ink-muted">
                              {items} {items === 1 ? 'item' : 'items'} · {answers} answered
                              {share.status !== 'active' && ' · archived'}
                            </p>
                          </div>
                          <span className="flex shrink-0 items-center gap-1 text-[12px] text-ink-faint">
                            <Link2 className="size-3.5" aria-hidden />
                            {live.length} live
                            {seen && ' · opened'}
                          </span>
                        </div>
                      </Card>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <CreateShareForm />
      </div>
    </>
  );
}
