import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/server';
import { createYouClient } from '@/lib/you/auth/server';
import { listRoster } from '@/lib/you/board-advisors';
import { loadPanel } from '@/lib/you/board-panels';
import { deleteBoardPanel, renameBoardPanel, setBoardPanelAdvisors } from '../../../actions';
import { PanelView } from './panel-view';

export const metadata = { title: 'Board panel' };
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One panel of advisors (plan #2561.12), on the detail pattern: its name, who
 * sits on it, and the way to delete it. The path is written here, as for a
 * board meeting, since panels are not a source (lib/you/sources.ts).
 */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const user = await requireUser();
  const client = await createYouClient();
  const [panel, roster] = await Promise.all([loadPanel(client, user.id, id), listRoster(client, user.id)]);
  if (!panel) notFound();
  return (
    <PanelView
      panel={panel}
      roster={roster}
      actions={{ rename: renameBoardPanel, setAdvisors: setBoardPanelAdvisors, remove: deleteBoardPanel }}
      subject={{
        ref: null,
        path: [
          { label: 'You', href: '/you' },
          { label: 'Board', href: '/you/board' },
          { label: 'Advisors', href: '/you/board/advisors' },
          { label: panel.name, href: `/you/board/advisors/panels/${id}` },
        ],
      }}
    />
  );
}
