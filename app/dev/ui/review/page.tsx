import { createClient, requireUser } from '@/lib/auth/server';
import { PageHeader } from '@/components/shell/page-header';
import { SURFACES } from '@/app/preview/surfaces';
import { MODULES } from '@/lib/modules';
import { loadUiReviews } from '@/lib/ui-review/load';
import { violationsByScope } from '@/lib/ui-review/gate';
import { isUiScope, type UiScope } from '@/lib/ui-review/scope';
import { ReviewView, type Standing } from './review-view';

export const metadata = { title: 'Review' };

export const dynamic = 'force-dynamic';

const LABEL: Record<UiScope, string> = {
  ...(Object.fromEntries(MODULES.map((module) => [module.id, module.label])) as Record<
    UiScope,
    string
  >),
  // The shell, the primitives, the account and auth pages: nobody's workspace,
  // and the gate counts them, so they are somebody's to look at too.
  shared: 'Shared',
};

/**
 * Where each module stands against the design laws.
 *
 * /dev/ui says what the standard is. This says who has been held to it: the
 * gate's count for a module, how much of it there is to look at, when it was
 * last reviewed and what that pass found. A module nobody has reviewed says so
 * — zero violations and never opened is the ordinary case, and reading the
 * first as the second is exactly the mistake this page exists to stop.
 */
export default async function DevUiReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ module?: string | string[] }>;
}) {
  const user = await requireUser();
  const supabase = await createClient();
  const params = await searchParams;

  const requested = Array.isArray(params.module) ? params.module[0] : params.module;
  const only: UiScope | null = requested && isUiScope(requested) ? requested : null;

  const reviews = await loadUiReviews(supabase, user.id);
  const violations = violationsByScope();

  const surfaces = SURFACES.reduce<Record<string, number>>((counts, surface) => {
    counts[surface.module] = (counts[surface.module] ?? 0) + 1;
    return counts;
  }, {});

  const standings: Standing[] = reviews
    .filter((row) => !only || row.scope === only)
    .map((row) => ({
      scope: row.scope,
      label: LABEL[row.scope],
      violations: violations[row.scope],
      surfaces: surfaces[row.scope] ?? 0,
      lastReview: row.lastReview,
    }));

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Review"
        description="One module at a time: what the gate counts, what there is to look at, and what the last pass found."
      />
      <ReviewView standings={standings} only={only} />
    </div>
  );
}
