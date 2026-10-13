import { PageColumn } from '@/components/shell/page-width';
import { PageHeader } from '@/components/shell/page-header';
import { requireUser } from '@/lib/auth/server';
import { createYouClient } from '@/lib/you/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { latestBigFive, type TypedResult } from '@/lib/you/personality/model';
import { loadPersonalityResults } from '@/lib/you/personality/store';
import { todayIn } from '@/lib/todo/tasks/model';
import { BigFiveTest } from '../big-five-test';
import { OtherTests } from '../other-tests';

export const metadata = { title: 'Personality test' };
export const dynamic = 'force-dynamic';

/**
 * The Big Five personality test (plan #1632), reached from You's
 * Personality tab. It was under Learn's Know page until #1991.2 moved it,
 * and /learn/know/personality redirects here.
 *
 * The 50-item IPIP markers, scored by their fixed key with no model call.
 * With a result already kept, the page opens on its scores and the test is
 * a press away; without one, it opens on the test.
 *
 * Below it, types from other tests typed in as the person has them (#1633).
 */
export default async function PersonalityTestPage() {
  const user = await requireUser();
  const you = await createYouClient();
  const [results, settings] = await Promise.all([
    loadPersonalityResults(you),
    loadAccountSettings(user.id),
  ]);
  const latest = latestBigFive(results);
  const typed = results.filter((r): r is TypedResult => r.kind !== 'big_five');

  return (
    <PageColumn>
      <PageHeader
        crumbs={[
          { label: 'Personality', href: '/you/personality' },
          { label: 'Personality test', href: '/you/personality/test' },
        ]}
        title="Personality test"
      />
      <BigFiveTest latest={latest} />
      <div className="mt-10">
        <OtherTests results={typed} today={todayIn(settings.timezone)} />
      </div>
    </PageColumn>
  );
}
