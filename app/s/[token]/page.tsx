import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { createSharePublicClient } from '@/lib/share/auth/public';
import { loadSharePage } from '@/lib/share/read/load-disposition';
import { ShareForm } from './share-form';

/**
 * The shared form.
 *
 * Someone with no account opens this, sees the shelf, and says what should
 * happen to each thing. It is not a Google Form: there is no submit button and
 * no blank second copy. Every control writes immediately, and what she sees on
 * her next visit is what the database holds -- hers to change again.
 *
 * This and app/api/s/[token]/respond are the only unauthenticated surface in
 * the shopping workspace. Both go through the two functions in
 * supabase/migrations/0042_share_rpcs.sql, which are the whole authorization
 * decision. There is no service-role client here and no RLS exemption.
 *
 * And it never calls out. No price lookup, no cover art, no enrichment -- see
 * docs/SHARE-LINKS-SPEC.md, the import boundary in eslint.config.mjs, and
 * tests/share-read.test.ts, which renders this data with fetch stubbed to
 * throw.
 */

/**
 * A link you text to one person is not a page you want indexed. `noindex`
 * belongs on the page rather than in a robots file because the URL is
 * unguessable -- a robots rule would have to name the path pattern, and the
 * page is the thing that knows it is private.
 */
export const metadata: Metadata = {
  title: 'Shared list',
  robots: { index: false, follow: false, nocache: true },
};

/**
 * Never cached. She and I are looking at the same rows, and a page served from
 * a cache is the one thing that would make "live" a lie.
 */
export const dynamic = 'force-dynamic';

export default async function SharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const page = await loadSharePage(createSharePublicClient(), token);

  // A wrong token, a revoked one and an expired one are one outcome on
  // purpose: a distinct "this link expired" page would confirm to anyone
  // guessing that the token they tried was once real.
  if (!page) notFound();

  return <ShareForm token={token} page={page} />;
}
