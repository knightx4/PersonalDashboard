import { PageHeader } from '@/components/shell/page-header';
import { requireUser } from '@/lib/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { latestBigFive, type TypedResult } from '@/lib/learn/personality/model';
import { loadPersonalityResults } from '@/lib/learn/personality/store';
import { todayIn } from '@/lib/todo/tasks/model';
import { BigFiveTest } from './big-five-test';
import { OtherTests } from './other-tests';

export const dynamic = 'force-dynamic';

/**
 * The Big Five personality test (plan #1632), reached from Know.
 *
 * The 50-item IPIP markers, scored by their fixed key with no model call.
 * With a result already kept, the page opens on its scores and the test is
 * a press away; without one, it opens on the test.
 *
 * Below it, types from other tests typed in as the person has them (#1633).
 */
export default async function PersonalityPage() {
  const user = await requireUser();
  const learn = await createLearnClient();
  const [results, settings] = await Promise.all([
    loadPersonalityResults(learn),
    loadAccountSettings(user.id),
  ]);
  const latest = latestBigFive(results);
  const typed = results.filter((r): r is TypedResult => r.kind !== 'big_five');

  return (
    <>
      <PageHeader
        crumbs={[
          { label: 'Learn', href: '/learn' },
          { label: 'Know', href: '/learn/know' },
          { label: 'Personality test', href: '/learn/know/personality' },
        ]}
        title="Personality test"
      />
      <BigFiveTest latest={latest} />
      <div className="mt-10">
        <OtherTests results={typed} today={todayIn(settings.timezone)} />
      </div>
    </>
  );
}
