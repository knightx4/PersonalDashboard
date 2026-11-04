import { requireUser } from '@/lib/auth/server';
import { createYouClient } from '@/lib/you/auth/server';
import { listRoster } from '@/lib/you/board-advisors';
import { hasOpenMeeting } from '@/lib/you/board';
import { listPanels } from '@/lib/you/board-panels';
import { recordsByKey } from '@/lib/you/board-profile';
import { loadTrackRecords } from '@/lib/you/board-scoring';
import { addBoardAdvisor, createBoardPanel, startMeeting } from '../actions';
import { spriteFor } from '@/lib/you/advisor-avatar-draw';
import { AdvisorAvatars } from '../advisor-avatar';
import { AdvisorsView } from './advisors-view';

export const metadata = { title: 'Advisors roster' };
export const dynamic = 'force-dynamic';

/** The time the page is read; outside the component, since reading the clock during render is unstable. */
function readAt(): number {
  return Date.now();
}

/**
 * The roster of the Advisors tab (plan #2561.7): the panels, then the five
 * seats and every guest as cards that open each advisor's profile
 * (plan #2581.5).
 */
export default async function Page() {
  const user = await requireUser();
  const client = await createYouClient();
  const [advisors, panels, running, records] = await Promise.all([
    listRoster(client, user.id),
    listPanels(client, user.id),
    hasOpenMeeting(client, user.id),
    loadTrackRecords(client, user.id),
  ]);
  return (
    <AdvisorAvatars {...spriteFor(advisors)}>
      <AdvisorsView
        advisors={advisors}
        panels={panels}
        meetingRunning={running}
        records={recordsByKey(records)}
        now={readAt()}
        subject={{
          ref: null,
          path: [
            { label: 'You', href: '/you' },
            { label: 'Advisors', href: '/you/board' },
            { label: 'Roster', href: '/you/board/advisors' },
          ],
        }}
        actions={{
          add: addBoardAdvisor,
          createPanel: createBoardPanel,
          startMeeting,
        }}
      />
    </AdvisorAvatars>
  );
}
