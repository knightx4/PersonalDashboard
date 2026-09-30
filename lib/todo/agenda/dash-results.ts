import 'server-only';

import { loadAccountSettings, moduleEnabled } from '@/lib/core/account/settings';
import { loadUnreadDashResults } from '@/lib/goals/steps-store';
import { sessionClients, type AgendaClients } from '@/lib/todo/agenda/clients';
import { todayIn } from '@/lib/todo/tasks/model';

/**
 * How many of Dash's results on your goals are waiting to be read, for the
 * one line Todo shows about them (plan #1268; docs/TODO-SPEC.md). Read beside
 * the agenda rather than through a source, because it is a count and not an
 * item: there is nothing to tick or put off, only somewhere to go and read.
 *
 * Zero when the Goals workspace is off, and zero when the read fails, so the
 * line is simply absent. A missing count costs a visit to Goals; a banner
 * about it would cost more than it saves.
 */
export async function loadDashResultsCount(
  userId: string,
  now: Date = new Date(),
  clients: AgendaClients = sessionClients,
): Promise<number> {
  try {
    const account = await loadAccountSettings(userId, await clients.core());
    if (!moduleEnabled(account, 'goals')) return 0;
    return await loadUnreadDashResults(await clients.goals(), {
      userId,
      today: todayIn(account.timezone, now),
    });
  } catch {
    return 0;
  }
}
