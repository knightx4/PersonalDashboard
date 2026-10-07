import { PageHeader } from '@/components/shell/page-header';
import { requireUser } from '@/lib/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import { latestBigFive } from '@/lib/learn/personality/model';
import { loadPersonalityResults } from '@/lib/learn/personality/store';
import { BigFiveTest } from './big-five-test';

export const dynamic = 'force-dynamic';

/**
 * The Big Five personality test (plan #1632), reached from Know.
 *
 * The 50-item IPIP markers, scored by their fixed key with no model call.
 * With a result already kept, the page opens on its scores and the test is
 * a press away; without one, it opens on the test.
 */
export default async function PersonalityPage() {
  await requireUser();
  const learn = await createLearnClient();
  const latest = latestBigFive(await loadPersonalityResults(learn));

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
    </>
  );
}
