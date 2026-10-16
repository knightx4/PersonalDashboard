import 'server-only';

import { createCoreServiceSupabase } from '@/inngest/core/supabase-admin';
import type { AskContext, SchemaClient } from '@/lib/ask/db';
import { executeAskTool } from '@/lib/ask/tools';
import { checkDashToken } from '@/lib/capture/tokens';
import { tokenAskDb } from '@/lib/connector/access';
import { loadAccountSettings } from '@/lib/core/account/settings';
import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import { recordSpendReports } from '@/lib/core/spend/record';
import { askDash } from '@/lib/dash/ask';
import { readMail } from '@/lib/inbox/read-mail';
import { searchMail } from '@/lib/inbox/search-mail';
import { readJobBoard } from '@/lib/jobs/discover/read-board';
import { todayInTimezone } from '@/lib/money';
import { allSearchSources } from '@/lib/search/registry';
import { appendTurns, loadConversation, startAsk } from './store';
import type { VoiceAskDeps } from './voice-ask';
import { openVoiceSession } from './voice-session';

/**
 * The ask address's clients: lib/talk/voice-ask.ts's dependencies.
 *
 * The token is checked on the service role, which is the only role that may
 * run core.use_dash_token. Everything after that runs on a session as the
 * token's owner (openVoiceSession), so the lookups and the kept conversation
 * pass row level security exactly as a question asked in the browser does.
 *
 * The answer is askDashInRequest's (lib/talk/ask-request.ts) without the
 * writes, the proposals, the hand-offs or the page: a spoken question has no
 * page, and nobody is there to confirm a change.
 */
export function voiceAskDeps(): VoiceAskDeps {
  return {
    check: (token) => checkDashToken(createCoreServiceSupabase() as unknown as SchemaClient, token, 'ask'),
    ask: async (userId, question) => {
      const session = await openVoiceSession(userId);
      try {
        const db = tokenAskDb(session.accessToken);
        const core = (await db('core')) as unknown as CoreSupabaseClient;
        const settings = await loadAccountSettings(userId, core);
        const today = todayInTimezone(settings.timezone);
        const ctx: AskContext = {
          userId,
          today,
          timezone: settings.timezone,
          enabledModules: settings.enabledModules,
          db,
          searchSources: allSearchSources(),
          searchMail: (search) => searchMail(core, userId, search),
          readMail: (message) => readMail(core, userId, message),
          readJobBoard,
        };
        return await askDash(
          {
            question,
            today,
            execute: (name, args) => executeAskTool(name, args, ctx),
            anthropicApiKey: process.env.ANTHROPIC_API_KEY,
          },
          {
            start: (q) => startAsk(core, userId, q),
            load: (ref) => loadConversation(core, { kind: 'ask', ref }),
            append: (subject, turns) => appendTurns(core, userId, subject, turns),
            recordSpend: (reports) =>
              recordSpendReports(core, userId, { module: 'core', operation: 'ask-dash' }, reports),
            // No propose is passed, so the loop refuses every proposal before one is kept.
            saveProposal: () => Promise.reject(new Error('Dash proposes nothing when asked by voice.')),
            attachProposals: async () => {},
            discardProposals: async () => {},
          },
        );
      } finally {
        await session.close();
      }
    },
  };
}
