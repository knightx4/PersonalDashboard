import 'server-only';

import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import type { YouSupabaseClient } from '@/lib/you/db/schema-name';
import { keepBotHandoff } from './bot-handoffs';
import { passToBot, type BotEntry, type BotPassPorts, type BotPasser } from './hand-to-bot';

/**
 * Passing a request to another bot (plan #3003.2), bound to the person's
 * own clients so RLS keeps both the roster read and the row kept to theirs.
 * The bots' reply code and Ask Dash are handed `botPasser`.
 */

/** The active people on People, as the names a request can go to. */
export async function listBotEntries(you: YouSupabaseClient, userId: string): Promise<BotEntry[]> {
  const { data, error } = await you.from('board_advisors').select('id, key, name').eq('user_id', userId).eq('active', true);
  if (error) throw new Error(`Reading your people failed: ${error.message}`);
  return ((data ?? []) as { id?: unknown; key?: unknown; name?: unknown }[]).flatMap((row) =>
    typeof row.id === 'string' && typeof row.name === 'string' && row.name.trim()
      ? [{ id: row.id, name: row.name.trim(), key: typeof row.key === 'string' ? row.key : null }]
      : [],
  );
}

export function botPassPorts(you: YouSupabaseClient, core: CoreSupabaseClient, userId: string): BotPassPorts {
  return {
    bots: () => listBotEntries(you, userId),
    keep: (input) => keepBotHandoff(core, userId, input),
  };
}

/** The passer a bot's reply is handed. */
export function botPasser(you: YouSupabaseClient, core: CoreSupabaseClient, userId: string): BotPasser {
  const ports = botPassPorts(you, core, userId);
  return (asker, input, seen) => passToBot(ports, asker, input, seen);
}
