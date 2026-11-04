import { PageColumn } from '@/components/shell/page-width';
import { PageHeader } from '@/components/shell/page-header';
import { requireUser } from '@/lib/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { createVaultClient } from '@/lib/vault/auth/server';
import { createYouClient } from '@/lib/you/auth/server';
import { latestBigFive, type BigFiveResult, type TypedResult } from '@/lib/you/personality/model';
import { loadPersonalityResults } from '@/lib/you/personality/store';
import { profileState } from '@/lib/you/personality/profile';
import { loadPersonalityProfile } from '@/lib/you/personality/profile-run';
import { loadTraitThemes } from '@/lib/you/personality/trait-themes-load';
import { PersonalitySection } from './personality-section';

export const metadata = { title: 'Personality' };
export const dynamic = 'force-dynamic';

/**
 * You's Personality tab (plan #1991.2): the latest Big Five as five traits
 * with the vault themes nearest each, Dash's read of it against your notes,
 * the types typed in from other tests with a read of each, and earlier
 * results folded beneath. This was the personality section of Learn's Know
 * page (plan #1634) until it moved here. The test and the typed-in types
 * are edited at /you/personality/test, a press away. Above them all, Dash's
 * analysis across the tests, offered again only when a test has changed.
 *
 * A failed read of the results takes the page to the workspace's error
 * screen, since the results are all the tab holds. Themes that could not be
 * matched are said inside the card instead.
 */
export default async function PersonalityPage() {
  const user = await requireUser();
  const you = await createYouClient();
  const [results, profile] = await Promise.all([
    loadPersonalityResults(you),
    loadPersonalityProfile(you),
  ]);
  const latest = latestBigFive(results);
  const earlier = results.filter(
    (r): r is BigFiveResult => r.kind === 'big_five' && r.id !== latest?.id,
  );
  const typed = results.filter((r): r is TypedResult => r.kind !== 'big_five');
  const themes = latest
    ? await loadTraitThemes(await createVaultClient(), user.id, latest.scores, {
        core: await createCoreClient(),
      })
    : null;

  return (
    <PageColumn>
      <PageHeader title="Personality" description="Your results from each test, side by side." />
      <PersonalitySection
        latest={latest}
        earlier={earlier}
        typed={typed}
        themes={themes}
        profile={{ profile, state: profileState(results, profile) }}
      />
    </PageColumn>
  );
}
