import 'server-only';

import type { InboxRow } from '@/components/inbox/inbox-page';
import { countReviewItems as countJobsReview } from '@/lib/jobs/review/load';
import { countReviewItems as countShoppingReview } from '@/lib/review/load';
import { countReadNow } from '@/lib/learn/tracks/load';
import { loadInboxNotes } from '@/lib/vault/notes/load';
import { sessionClients } from '@/lib/todo/agenda/clients';
import { loadAgenda } from '@/lib/todo/agenda/load';
import { allSources, sourceModule } from '@/lib/todo/agenda/registry';
import { inboxEntries, type AgendaInbox } from '@/lib/todo/agenda/workspace';
import { todayIn } from '@/lib/todo/tasks/model';
import { agendaInboxRow, type SourceAbilities } from '@/lib/inbox/agenda-rows';
import { queueRow, type InboxQueue } from '@/lib/inbox/queue-rows';
import {
  answerInboxItem,
  declineInboxItem,
  doneInboxItem,
  doneInboxTask,
  laterInboxItem,
  laterInboxTask,
} from '@/lib/inbox/agenda-actions';

/**
 * A workspace's Inbox (plan #1937.5): the agenda's on-you entries for that
 * workspace, then a row for each queue it keeps on a page of its own.
 *
 * A source or a queue that fails is named in `failed` rather than taking the
 * page down, as on the agenda: a shorter Inbox that says why beats a broken one.
 */

export type WorkspaceInbox = { rows: InboxRow[]; failed: string[] };

const ACTIONS = {
  done: doneInboxItem,
  later: laterInboxItem,
  decline: declineInboxItem,
  answer: answerInboxItem,
  doneTask: doneInboxTask,
  laterTask: laterInboxTask,
};

function abilities(): SourceAbilities {
  return Object.fromEntries(
    allSources().map((source) => [
      source.id,
      {
        complete: !!source.complete,
        defer: !!source.defer,
        dismiss: !!source.dismiss,
        answer: !!source.answer,
      },
    ]),
  );
}

/** Each workspace's queues, counted on the session. */
const QUEUE_COUNTS: Partial<Record<AgendaInbox, { queue: InboxQueue; label: string; count: (userId: string) => Promise<number> }[]>> = {
  shopping: [
    {
      queue: 'shopping-review',
      label: 'Review',
      count: async (userId) =>
        countShoppingReview(await sessionClients.shopping(), await sessionClients.core(), userId),
    },
  ],
  jobs: [
    {
      queue: 'jobs-review',
      label: 'Review',
      count: async (userId) =>
        countJobsReview(await sessionClients.jobs(), await sessionClients.core(), userId),
    },
  ],
  vault: [
    {
      queue: 'vault-triage',
      label: 'Quick notes',
      count: async () => (await loadInboxNotes(await sessionClients.vault())).length,
    },
  ],
  learn: [
    {
      queue: 'learn-read-now',
      label: 'Queued readings',
      count: async () => countReadNow(await sessionClients.learn()),
    },
  ],
};

export async function loadWorkspaceInbox(userId: string, workspace: AgendaInbox): Promise<WorkspaceInbox> {
  const now = new Date();
  const queues = QUEUE_COUNTS[workspace] ?? [];

  const [agenda, counted] = await Promise.all([
    loadAgenda(userId, now, sessionClients, { workspace }),
    Promise.allSettled(queues.map((q) => q.count(userId))),
  ]);

  const today = todayIn(agenda.timezone, now);
  const can = abilities();
  const failed = [...agenda.failed];

  const queueRows: InboxRow[] = [];
  counted.forEach((result, index) => {
    if (result.status === 'rejected') {
      failed.push(queues[index].label);
      return;
    }
    const row = queueRow(queues[index].queue, result.value);
    if (row) queueRows.push(row);
  });

  const rows = inboxEntries(agenda.piles, workspace, sourceModule)
    .map((entry) => agendaInboxRow(entry, ACTIONS, can, today))
    .filter((row): row is InboxRow => row !== null);

  return { rows: [...queueRows, ...rows], failed };
}
