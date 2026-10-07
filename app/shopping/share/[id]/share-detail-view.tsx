import Link from 'next/link';
import { ArrowLeft, Package } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { Card, CardSection } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { formatMoneyOrBlank } from '@/lib/money';
import { ShareControls, ShareLinkRow } from '../share-ui';
import { ApplyDecision } from './apply-decision';
import { formatClock } from '@/lib/clock';

/** One title on the form, as share_page() returns it. */
export type ShareGroup = {
  groupKey: string;
  name: string;
  quantity: number;
  imageUrl: string | null;
  unitPriceCents: number | null;
  keepQty: number;
  sellQty: number;
  giveawayQty: number;
  note: string | null;
  answeredAt: string | null;
};

export type ShareToken = {
  id: string;
  token: string;
  label: string;
  revoked_at: string | null;
  last_seen_at: string | null;
};

export type ShareEvent = {
  id: string;
  kind: string;
  group_key: string | null;
  created_at: string;
};

/**
 * One share from my side, drawn from what the page read (page.tsx), so the
 * gallery can draw it from fixtures (plan #1604).
 */
export function ShareDetailView({
  share,
  groups,
  tokens,
  events,
  origin,
}: {
  share: { id: string; title: string; status: string };
  groups: ShareGroup[];
  tokens: ShareToken[];
  events: ShareEvent[];
  origin: string;
}) {
  const answered = groups.filter((g) => g.keepQty + g.sellQty + g.giveawayQty > 0);

  return (
    <div className="[&_a]:press-area">
      <Link
        href="/shopping/share"
        className="mb-3 inline-flex items-center gap-1.5 text-ui text-ink-muted transition-colors duration-quick hover:text-ink"
      >
        <ArrowLeft className="size-3.5" strokeWidth={1.75} aria-hidden /> Shared forms
      </Link>

      <PageHeader
        title={share.title}
        description={
          share.status === 'active'
            ? `${groups.length} titles · ${answered.length} answered`
            : 'Archived — every link to this has stopped working.'
        }
        actions={<ShareControls shareId={share.id} archived={share.status !== 'active'} />}
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0">
          {groups.length === 0 ? (
            <EmptyState
              icon={Package}
              title="Nothing on this form yet"
              description="Add things from your inventory and they show up here, ready to send."
              action={{ label: 'Open inventory', href: '/shopping/inventory' }}
            />
          ) : (
            /* One surface, hairlines between (law 13). A card per row on a
             * form that can hold a whole household's things is the difference
             * between seeing six of them and seeing fifteen. */
            <Card padding="none">
              <ul className="divide-y divide-border">
                {groups.map((group) => {
                  const decided = group.keepQty + group.sellQty + group.giveawayQty;
                  const price = formatMoneyOrBlank(group.unitPriceCents);
                  return (
                    <li
                      key={group.groupKey}
                      className="card-pad-x row-pad flex flex-wrap items-center gap-3"
                    >
                      {/* Ground, no frame: this tile is already inside the
                          row. Law 11. */}
                      <div className="size-12 shrink-0 overflow-hidden rounded-lg bg-canvas">
                        {group.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={group.imageUrl} alt="" className="size-full object-cover" />
                        ) : (
                          <div className="flex size-full items-center justify-center text-ink-muted">
                            <Package className="size-4" strokeWidth={1.75} aria-hidden />
                          </div>
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <p className="text-body font-medium text-ink">
                          {group.name}
                          {group.quantity > 1 && (
                            <span className="ml-1.5 text-ink-muted">× {group.quantity}</span>
                          )}
                        </p>
                        <p className="mt-0.5 text-ui text-ink-muted">
                          {decided === 0 ? (
                            <span className="text-ink-muted">Not answered</span>
                          ) : (
                            [
                              group.keepQty > 0 && `keep ${group.keepQty}`,
                              group.sellQty > 0 && `sell ${group.sellQty}`,
                              group.giveawayQty > 0 && `give away ${group.giveawayQty}`,
                            ]
                              .filter(Boolean)
                              .join(' · ')
                          )}
                          {/* Blank, not $0.00, when the price is unknown. */}
                          {price && <span className="text-ink-muted"> · {price}</span>}
                        </p>
                        {group.note && (
                          <p className="mt-1 text-ui text-ink-muted italic">“{group.note}”</p>
                        )}
                      </div>

                      {decided > 0 && (
                        <ApplyDecision
                          shareId={share.id}
                          groupKey={group.groupKey}
                          sellQty={group.sellQty}
                          giveawayQty={group.giveawayQty}
                        />
                      )}
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}
        </div>

        <div className="min-w-0 space-y-4">
          <CardSection title="Links">
            {/* Divided rows rather than a box each: the Links card is the
                frame. Law 11. */}
            <div className="divide-y divide-border">
              {tokens.map((token) => (
                <ShareLinkRow
                  key={token.id}
                  tokenId={token.id}
                  url={`${origin}/s/${token.token}`}
                  label={token.label}
                  revoked={Boolean(token.revoked_at)}
                  lastSeenAt={token.last_seen_at}
                />
              ))}
            </div>
            <p className="mt-3 text-small text-ink-muted">
              Anyone holding a live link can read and change these answers. Revoke one and it stops
              working immediately; the answers it left stay.
            </p>
          </CardSection>

          <CardSection title="Recent activity">
            {events.length === 0 ? (
              <p className="text-ui text-ink-muted">Nothing yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {events.map((event) => (
                  <li key={event.id} className="text-small text-ink-muted">
                    <span className="text-ink-muted">
                      {formatClock(event.created_at, { day: 'numeric', month: 'short', year: 'numeric' }, undefined)}
                    </span>{' '}
                    {event.kind.replace(/_/g, ' ')}
                    {event.group_key && (
                      <span className="text-ink-muted"> · {event.group_key}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardSection>
        </div>
      </div>
    </div>
  );
}
