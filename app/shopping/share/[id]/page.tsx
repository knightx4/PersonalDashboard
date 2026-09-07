import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Package } from 'lucide-react';
import { createClient, requireUser } from '@/lib/auth/server';
import { PageHeader } from '@/components/shell/page-header';
import { Card } from '@/components/ui/card';
import { formatMoneyOrBlank } from '@/lib/money';
import { requestOrigin } from '@/lib/auth/origin';
import { ShareControls, ShareLinkRow } from '../share-ui';
import { ApplyDecision } from './apply-decision';

export const metadata = { title: 'Shared form' };

/**
 * One share, from my side.
 *
 * Deliberately reads the same shape she sees, through the same function, so
 * "what does the link show" is answered by looking rather than by reasoning
 * about two queries that are supposed to agree. The extra things here are the
 * ones she must not have: the links themselves, and the ability to act on what
 * she chose.
 */
export default async function ShareDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  const supabase = await createClient();

  const { data: share } = await supabase
    .from('share_links')
    .select('id, title, intro, status, created_at')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!share) notFound();

  const [{ data: tokens }, { data: events }] = await Promise.all([
    supabase
      .from('share_link_tokens')
      .select('id, token, label, revoked_at, expires_at, last_seen_at, created_at')
      .eq('share_link_id', id)
      .order('created_at', { ascending: false }),
    supabase
      .from('share_link_events')
      .select('id, kind, group_key, payload, created_at')
      .eq('share_link_id', id)
      .order('created_at', { ascending: false })
      .limit(20),
  ]);

  // The owner's view of the page goes through share_page() as well, using the
  // first live token. One reader means one answer to "what is on this form".
  const liveToken = (tokens ?? []).find((t) => !t.revoked_at);
  const { data: pageData } = liveToken
    ? await supabase.rpc('share_page', { p_token: liveToken.token })
    : { data: null };

  const page = pageData as {
    groups: Array<{
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
    }>;
  } | null;

  const groups = page?.groups ?? [];
  const answered = groups.filter((g) => g.keepQty + g.sellQty + g.giveawayQty > 0);
  // The live host, not NEXT_PUBLIC_APP_URL: this link is copied out of the
  // app and sent to someone else, and the env var defaults to localhost, so a
  // deployment that never set it handed out links nobody but the sender could
  // open. The header says where the reader actually is.
  const origin = await requestOrigin();

  return (
    <>
      <Link
        href="/shopping/share"
        className="mb-3 inline-flex items-center gap-1.5 text-ui text-ink-muted hover:text-ink"
      >
        <ArrowLeft className="size-3.5" aria-hidden /> Shared forms
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
        <div>
          {groups.length === 0 ? (
            <Card className="p-6 text-body text-ink-muted">
              Nothing on this form yet. Add things from{' '}
              <Link href="/shopping/inventory" className="text-accent hover:underline">
                your inventory
              </Link>
              .
            </Card>
          ) : (
            <ul className="space-y-2">
              {groups.map((group) => {
                const decided = group.keepQty + group.sellQty + group.giveawayQty;
                const price = formatMoneyOrBlank(group.unitPriceCents);
                return (
                  <li key={group.groupKey}>
                    <Card className="flex flex-wrap items-center gap-3 p-3">
                      <div className="size-12 shrink-0 overflow-hidden rounded-lg border border-border bg-canvas">
                        {group.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={group.imageUrl} alt="" className="size-full object-cover" />
                        ) : (
                          <div className="flex size-full items-center justify-center text-ink-muted">
                            <Package className="size-4" aria-hidden />
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
                          <p className="mt-1 text-ui text-ink-muted italic">
                            “{group.note}”
                          </p>
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
                    </Card>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="space-y-4">
          <Card className="p-4">
            <h2 className="mb-2 text-body font-semibold text-ink">Links</h2>
            <div className="space-y-2">
              {(tokens ?? []).map((token) => (
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
              Anyone holding a live link can read and change these answers. Revoke
              one and it stops working immediately; the answers it left stay.
            </p>
          </Card>

          <Card className="p-4">
            <h2 className="mb-2 text-body font-semibold text-ink">Recent activity</h2>
            {(events ?? []).length === 0 ? (
              <p className="text-ui text-ink-muted">Nothing yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {(events ?? []).map((event) => (
                  <li key={event.id} className="text-small text-ink-muted">
                    <span className="text-ink-muted">
                      {new Date(event.created_at).toLocaleString()}
                    </span>{' '}
                    {event.kind.replace(/_/g, ' ')}
                    {event.group_key && (
                      <span className="text-ink-muted"> · {event.group_key}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
