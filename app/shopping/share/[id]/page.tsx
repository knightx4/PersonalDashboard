import { notFound } from 'next/navigation';
import { createClient, requireUser } from '@/lib/auth/server';
import { requestOrigin } from '@/lib/auth/origin';
import { ShareDetailView, type ShareGroup } from './share-detail-view';

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
export default async function ShareDetailPage({ params }: { params: Promise<{ id: string }> }) {
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

  const page = pageData as { groups: ShareGroup[] } | null;

  // The live host, not NEXT_PUBLIC_APP_URL: this link is copied out of the
  // app and sent to someone else, and the env var defaults to localhost, so a
  // deployment that never set it handed out links nobody but the sender could
  // open. The header says where the reader actually is.
  const origin = await requestOrigin();

  return (
    <ShareDetailView
      share={share}
      groups={page?.groups ?? []}
      tokens={tokens ?? []}
      events={events ?? []}
      origin={origin}
    />
  );
}
