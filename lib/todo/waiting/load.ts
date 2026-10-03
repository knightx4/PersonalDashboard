import 'server-only';

import { loadAccountSettings, moduleEnabled } from '@/lib/core/account/settings';
import { loadApplicationMoves } from '@/lib/jobs/applications/moves';
import { loadReturnsTracker } from '@/lib/returns/load';
import { sessionClients, type AgendaClients } from '@/lib/todo/agenda/clients';
import {
  applicationWaits,
  groupWaiting,
  returnWaits,
  type WaitingEntry,
  type WaitingGroup,
} from '@/lib/todo/waiting/model';

/**
 * Everything waiting on someone else, read live from each workspace that
 * works out a move and has rows waiting on a party outside the app (plan
 * #1475). Nothing is copied: each reader asks its workspace at render time,
 * and one that fails is named on the page rather than leaving a shorter
 * list that looks complete. A switched-off workspace is not read.
 */

export interface Waiting {
  groups: WaitingGroup[];
  timezone: string;
  /** Workspaces that are on and did not answer, named for the page. */
  failed: string[];
}

interface Reader {
  label: string;
  module: 'jobs' | 'shopping';
  read(userId: string, clients: AgendaClients): Promise<WaitingEntry[]>;
}

const READERS: Reader[] = [
  {
    label: 'Job applications',
    module: 'jobs',
    async read(userId, clients) {
      return applicationWaits(await loadApplicationMoves(await clients.jobs(), userId));
    },
  },
  {
    label: 'Orders on their way',
    module: 'shopping',
    async read(userId, clients) {
      const data = await loadReturnsTracker(await clients.shopping(), userId, 'all');
      return returnWaits(data.rows);
    },
  },
];

export async function loadWaiting(
  userId: string,
  clients: AgendaClients = sessionClients,
): Promise<Waiting> {
  const account = await loadAccountSettings(userId, await clients.core());
  const readers = READERS.filter((reader) => moduleEnabled(account, reader.module));

  const settled = await Promise.allSettled(readers.map((reader) => reader.read(userId, clients)));
  const entries: WaitingEntry[] = [];
  const failed: string[] = [];
  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') entries.push(...result.value);
    else failed.push(readers[index].label);
  });

  return { groups: groupWaiting(entries), timezone: account.timezone, failed };
}
