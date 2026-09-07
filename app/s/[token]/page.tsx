import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { createSharePublicClient } from '@/lib/share/auth/public';
import { loadSharePage } from '@/lib/share/read/load-disposition';
import { formatMoneyOrBlank } from '@/lib/money';
import { DispositionGroup } from './disposition-group';

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

  const decidedAll = page.totals.decided >= page.totals.units && page.totals.units > 0;

  return (
    <main className="mx-auto max-w-2xl px-4 py-8 sm:px-5 sm:py-12">
      <header>
        <h1 className="font-display text-2xl text-ink">{page.title}</h1>
        {page.intro && (
          <p className="mt-2 text-lead leading-relaxed text-ink-muted">{page.intro}</p>
        )}
        <p className="mt-3 text-ui text-ink-muted">
          {page.totals.units} {page.totals.units === 1 ? 'item' : 'items'}
          {page.totals.products !== page.totals.units && (
            <> across {page.totals.products} titles</>
          )}
          {page.canRespond && (
            <>
              {' · '}
              {decidedAll ? 'all decided' : `${page.totals.units - page.totals.decided} left`}
            </>
          )}
        </p>
        {page.canRespond ? (
          <p className="mt-4 rounded-lg bg-accent-tint px-3 py-2 text-ui text-ink-muted">
            Nothing to submit — every change saves as you make it, and you can
            come back and change your mind any time.
          </p>
        ) : (
          <p className="mt-4 rounded-lg bg-canvas px-3 py-2 text-ui text-ink-muted">
            This link is read-only.
          </p>
        )}
      </header>

      {page.groups.length === 0 && (
        <p className="mt-10 text-lead text-ink-muted">
          There is nothing on this list yet.
        </p>
      )}

      {page.families.map((family) => (
        <section key={family.key ?? '__loose'} className="mt-8">
          {family.label && (
            <h2 className="mb-3 text-ui font-semibold tracking-wide text-ink-muted uppercase">
              {family.label}
            </h2>
          )}
          <ul className="space-y-3">
            {family.groups.map((group) => (
              <DispositionGroup
                key={group.groupKey}
                token={token}
                group={group}
                canRespond={page.canRespond}
                // Formatted here, on the server, because formatting money is
                // lib/money's job and the stepper is a client component.
                priceLabel={formatMoneyOrBlank(group.unitPriceCents)}
              />
            ))}
          </ul>
        </section>
      ))}

      <p className="mt-12 text-small text-ink-muted">
        Shared privately. Anyone with this link can see and change these choices.
      </p>
    </main>
  );
}
