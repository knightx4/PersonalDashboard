import { requireUser } from '@/lib/auth/server';
import { createYouClient } from '@/lib/you/auth/server';
import { listRoster } from '@/lib/you/board-advisors';
import { listPanels } from '@/lib/you/board-panels';
import { addBoardAdvisor, createBoardPanel, retryAdvisorBrain, setAdvisorActive } from '../actions';
import { AdvisorsView } from './advisors-view';

export const metadata = { title: 'Board advisors' };
export const dynamic = 'force-dynamic';

/** The time the page is read; outside the component, since reading the clock during render is unstable. */
function readAt(): number {
  return Date.now();
}

/**
 * The Advisors view of the Board tab (plan #2561.7): the five seats and every
 * guest, each guest's brain and the switch for the chair.
 */
export default async function Page() {
  const user = await requireUser();
  const client = await createYouClient();
  const [advisors, panels] = await Promise.all([listRoster(client, user.id), listPanels(client, user.id)]);
  return (
    <AdvisorsView
      advisors={advisors}
      panels={panels}
      now={readAt()}
      subject={{
        ref: null,
        path: [
          { label: 'You', href: '/you' },
          { label: 'Board', href: '/you/board' },
          { label: 'Advisors', href: '/you/board/advisors' },
        ],
      }}
      actions={{
        add: addBoardAdvisor,
        retry: retryAdvisorBrain,
        setActive: setAdvisorActive,
        createPanel: createBoardPanel,
      }}
    />
  );
}
