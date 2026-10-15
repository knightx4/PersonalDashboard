import 'server-only';

import { cache } from 'react';
import type { InboxRow } from '@/components/inbox/inbox-page';
import { agendaRowsOf, queueRowsFor } from '@/lib/inbox/workspace-inbox';
import { modulesFor, type ModuleId } from '@/lib/modules';
import { sessionClients } from '@/lib/todo/agenda/clients';
import { loadAgenda } from '@/lib/todo/agenda/load';
import { sourceModule } from '@/lib/todo/agenda/registry';
import { AGENDA_INBOXES, homeInboxEntries } from '@/lib/todo/agenda/workspace';
import { todayIn } from '@/lib/todo/tasks/model';

/**
 * Home's Inbox (plan #1937.7): everything on you in every workspace, grouped
 * by workspace. It took the bell's place, so it answers the bell's question
 * from anywhere the person starts: what is waiting on me?
 *
 * Drawn from the one on-you list, the agenda (docs/CORE-AND-DASH-SPEC.md
 * Part 4), cut as each workspace's Inbox cuts it, plus each workspace's
 * queues as one row each. A row here is the same row its workspace's Inbox
 * shows, with the same verbs, so a press changes it in both at once.
 */

/** One workspace's part of Home's Inbox. */
export type HomeInboxGroup = { workspace: ModuleId; label: string; href: string; rows: InboxRow[] };

export type HomeInbox = { groups: HomeInboxGroup[]; total: number; failed: string[] };

/**
 * The whole agenda, read once a request. Home's page and its Inbox count
 * read the same promise, so the first screen pays for one agenda, not two.
 */
export const loadHomeAgenda = cache((userId: string) => loadAgenda(userId, new Date(), sessionClients));

/** Where a workspace's group heading goes: its own Inbox, or its first page. */
function inboxHref(id: ModuleId, home: string): string {
  return (AGENDA_INBOXES as readonly string[]).includes(id) || id === 'goals' || id === 'dev'
    ? `/${id}/inbox`
    : home;
}

/**
 * Home's Inbox for the workspaces the person has on. `owner` decides whether
 * Dev is one of them, as it does in the switcher.
 */
export async function loadHomeInbox(
  userId: string,
  { owner, enabled }: { owner: boolean; enabled: (id: ModuleId) => boolean },
): Promise<HomeInbox> {
  const modules = modulesFor(owner).filter((module) => enabled(module.id));
  const queued = AGENDA_INBOXES.filter((id) => modules.some((module) => module.id === id));

  const [agenda, queues] = await Promise.all([
    loadHomeAgenda(userId),
    Promise.all(queued.map((id) => queueRowsFor(userId, id))),
  ]);
  const today = todayIn(agenda.timezone, new Date());
  const entries = homeInboxEntries(agenda.piles, sourceModule);

  const groups: HomeInboxGroup[] = [];
  for (const workspace of modules) {
    const queue = queues[queued.indexOf(workspace.id as (typeof AGENDA_INBOXES)[number])];
    const rows = [
      ...(queue?.rows ?? []),
      ...agendaRowsOf(
        entries.filter((row) => row.workspace === workspace.id).map((row) => row.entry),
        today,
      ),
    ];
    if (rows.length === 0) continue;
    groups.push({
      workspace: workspace.id,
      label: workspace.label,
      href: inboxHref(workspace.id, workspace.home),
      rows,
    });
  }

  return {
    groups,
    total: groups.reduce((sum, group) => sum + group.rows.length, 0),
    failed: [...agenda.failed, ...queues.flatMap((queue) => queue.failed)],
  };
}
