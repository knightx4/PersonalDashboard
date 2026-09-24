import { PageHeader } from '@/components/shell/page-header';
import { requireUser } from '@/lib/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import { loadActiveAims, loadAimAreaNames } from '@/lib/learn/aims-store';
import { aimPlace, type Aim, type AimPlace } from '@/lib/learn/aims';
import { GoalsView } from './goals-view';

export const dynamic = 'force-dynamic';

/**
 * The things you want to learn and how well (plan #895, this page is #897).
 *
 * The page says Goals; the code and the table say aims, because `goals`
 * already means a concept typed into a track. Learn now reads these to bring
 * cards towards them (#900).
 */
/** Each goal's place, read against the clock once per request. */
function placesOf(aims: Aim[], areaNames: Map<string, string>): Record<string, AimPlace> {
  const now = Date.now();
  return Object.fromEntries(aims.map((aim) => [aim.id, aimPlace(aim, areaNames, now)]));
}

export default async function GoalsPage() {
  await requireUser();
  const supabase = await createLearnClient();

  // A failed read becomes a line where the list would be, not a broken page.
  let aims: Aim[] | null = null;
  try {
    aims = await loadActiveAims(supabase);
  } catch {
    aims = null;
  }

  // Where each goal sits in the area grid (#898). Names that cannot be read
  // leave a placed goal saying "a field" rather than failing the page.
  let areaNames = new Map<string, string>();
  if (aims) {
    try {
      areaNames = await loadAimAreaNames(supabase, aims);
    } catch {
      areaNames = new Map();
    }
  }
  const places = placesOf(aims ?? [], areaNames);

  return (
    <>
      <PageHeader
        title="Goals"
        description="A few broad things you want to learn, and how well. Learn now brings you cards towards them."
      />
      {aims ? (
        <GoalsView aims={aims} places={places} />
      ) : (
        <p className="text-ui text-ink-muted">Your goals could not be read. Reload to try again.</p>
      )}
    </>
  );
}
