import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { createPublicClient } from '@/lib/jobs/auth/public';
import { CaseView, type CasePage } from './case-view';

/**
 * The case page: the requirement map, with your evidence beside each line,
 * rendered for someone with no account.
 *
 * It is a work sample and a cover letter in one, and it costs nothing once the
 * requirement map exists — which is the whole argument for building it here
 * rather than as its own artifact. Standalone cover letter generation is
 * dropped; `cover_letters` carries this instead.
 *
 * This is the only unauthenticated read in the application. The read goes
 * through `job_search.public_case_page()`, a `security definer` function that
 * checks expiry and returns exactly one shared page — not a service-role
 * client, and not an RLS exemption on the table. Gap lines and uncited
 * evidence never leave the database at all: see the migration, and the
 * negative cases in tests/rls-jobs.test.ts.
 */

/**
 * A link you send to one employer is not a page you want indexed. `noindex`
 * belongs on the page rather than in a robots file because the URL is
 * unguessable — a robots rule would have to name the path pattern, and the
 * page is the thing that knows it is private.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = 'force-dynamic';

export default async function PublicCasePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = createPublicClient();

  const { data, error } = await supabase.rpc('public_case_page', { p_slug: slug });

  // An expired link, a wrong slug and a link that was never shared are one
  // outcome on purpose: a distinct "this expired" page would confirm the slug
  // was real to anyone who guessed at one.
  if (error || !data) notFound();

  return <CaseView page={data as unknown as CasePage} />;
}
