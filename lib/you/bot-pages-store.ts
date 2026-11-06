import 'server-only';

import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import { recordSpend } from '@/lib/core/spend/record';
import { dashBackupRoutine, fireFeatureRoutine } from '@/lib/feedback/routine';
import { startBotPage, type BotPagePorts, type BotPageStarter } from '@/lib/you/bot-pages';

/**
 * Starting a bot's page from a reply (plan #2997): the ports of
 * lib/you/bot-pages.ts bound to the person's own core client, so RLS keeps
 * the hand-off to their rows, and to the Dash backup routine.
 */

/** What a run is counted as in core.model_spend: it runs in a session, so it has no tokens to price. */
export const BOT_PAGE_SPEND = { module: 'you', operation: 'make-bot-page', model: 'claude-code-routine' } as const;

/** Whether pages can be made on this deployment: the routine has an id and a token. */
export function canMakePages(): boolean {
  const routine = dashBackupRoutine();
  return Boolean(routine.id && routine.token);
}

/** Postgres's unique violation: this message already has a page. */
const UNIQUE_VIOLATION = '23505';

export function botPagePorts(core: CoreSupabaseClient, userId: string): BotPagePorts {
  const routine = dashBackupRoutine();
  return {
    async keep(asker, page) {
      const { data, error } = await core
        .from('dash_handoffs')
        .insert({
          user_id: userId,
          kind: 'page',
          advisor_id: asker.advisorId,
          advisor_chat_id: asker.chatId,
          message_id: asker.messageId,
          asked: asker.asked.slice(0, 20000) || null,
          persona: asker.persona.slice(0, 40000) || null,
          request: page.request,
          title: page.title,
          context: page.context,
        })
        .select('id')
        .single();
      if (error?.code === UNIQUE_VIOLATION) return null;
      if (error || typeof data?.id !== 'string') throw new Error(`Keeping the page request failed: ${error?.message ?? 'no id'}`);
      return { id: data.id };
    },
    fire: (brief) => fireFeatureRoutine({ apiKey: routine.token, routineId: routine.id, text: brief }),
    async mark(id, fired) {
      const at = new Date().toISOString();
      // A page that would not start is told by the bot's own reply, so told_at is set with it.
      const { error } = await core
        .from('dash_handoffs')
        .update(
          fired.ok
            ? { status: 'fired', run_id: fired.runId, fired_at: at }
            : { status: 'failed', error: fired.error.slice(0, 1000), finished_at: at, told_at: at },
        )
        .eq('id', id)
        .eq('user_id', userId);
      if (error) throw new Error(`Marking the page request failed: ${error.message}`);
    },
    async count() {
      await recordSpend(core, userId, {
        module: BOT_PAGE_SPEND.module,
        operation: BOT_PAGE_SPEND.operation,
        model: BOT_PAGE_SPEND.model,
        usage: { inputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 0 },
      });
    },
  };
}

/** The starter a reply is handed, or null when pages cannot be made here. */
export function botPageStarter(core: CoreSupabaseClient, userId: string): BotPageStarter | null {
  if (!canMakePages()) return null;
  const ports = botPagePorts(core, userId);
  return (asker, input) => startBotPage(ports, asker, input, userId);
}
