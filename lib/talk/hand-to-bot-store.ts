import 'server-only';

import { after } from 'next/server';
import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import type { YouSupabaseClient } from '@/lib/you/db/schema-name';
import { keepBotHandoff } from './bot-handoffs';
import { passToBot, type BotEntry, type BotPassPorts, type BotPasser } from './hand-to-bot';

/**
 * Passing a request to another bot (plan #3003.2), bound to the person's
 * own clients so RLS keeps both the roster read and the row kept to theirs.
 * The bots' reply code and Ask Dash are handed `botPasser`. A row newly
 * kept is taken up by its receiver once this request has answered (plan
 * #3003.3, lib/you/bot-handoff-reply-request.ts); a repeat of one already
 * kept starts nothing.
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
    keep: async (input) => {
      const kept = await keepBotHandoff(core, userId, input);
      if (kept.ok && kept.created) startBotHandoffReceiver(userId, kept.handoff.id);
      return kept;
    },
  };
}

/**
 * The receiving bot's run, after the sending bot's reply is out. Loaded
 * when it starts, since the run reads Ask Dash's tools, whose request file
 * hands out this passer. Outside a request there is no `after`, so it runs
 * alongside instead. Dev home's Resend starts it the same way (plan #3003.4).
 */
export function startBotHandoffReceiver(userId: string, handoffId: string): void {
  const run = async () => {
    try {
      const { answerBotHandoffInRequest } = await import('@/lib/you/bot-handoff-reply-request');
      const done = await answerBotHandoffInRequest(userId, handoffId);
      console.info(`bot-handoff ${handoffId} ${done.status}${done.status === 'skipped' ? `: ${done.why}` : ''}`);
    } catch (error) {
      console.error('the receiving bot could not take up the hand-off', error);
    }
  };
  try {
    after(run);
  } catch {
    void run();
  }
}

/** The passer a bot's reply is handed. */
export function botPasser(you: YouSupabaseClient, core: CoreSupabaseClient, userId: string): BotPasser {
  const ports = botPassPorts(you, core, userId);
  return (asker, input, seen) => passToBot(ports, asker, input, seen);
}
