import 'server-only';

import { createCoreClient } from '@/lib/core/auth/server';
import { createYouClient } from '@/lib/you/auth/server';
import { FLAGGED_WINDOW_MS, loadFlaggedBotHandoffs } from '@/lib/talk/bot-handoffs';
import { flaggedLines, type FlagBot, type FlaggedLine } from '@/lib/talk/bot-handoff-flags';

/**
 * Dev home's flagged bot hand-offs of the last week (plan #3003.4), with the
 * bots named from People. Empty when they could not be read: Home opens
 * without the list rather than failing.
 */
export async function loadFlaggedLines(userId: string, now: number): Promise<FlaggedLine[]> {
  try {
    const [core, you] = await Promise.all([createCoreClient(), createYouClient()]);
    const handoffs = await loadFlaggedBotHandoffs(core, userId, new Date(now - FLAGGED_WINDOW_MS).toISOString());
    if (handoffs.length === 0) return [];
    const { data, error } = await you.from('board_advisors').select('id, key, name').eq('user_id', userId);
    if (error) throw new Error(error.message);
    const bots = ((data ?? []) as { id?: unknown; key?: unknown; name?: unknown }[]).flatMap((row): FlagBot[] =>
      typeof row.id === 'string' && typeof row.key === 'string' && typeof row.name === 'string'
        ? [{ id: row.id, key: row.key, name: row.name }]
        : [],
    );
    return flaggedLines(handoffs, bots);
  } catch (error) {
    console.error('the flagged bot hand-offs were not read', error);
    return [];
  }
}
