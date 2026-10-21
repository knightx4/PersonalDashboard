import 'server-only';

import { createClient } from '@supabase/supabase-js';
import { after } from 'next/server';
import { createCoreServiceSupabase } from '@/inngest/core/supabase-admin';
import type { AskContext, SchemaClient } from '@/lib/ask/db';
import { executeAskTool } from '@/lib/ask/tools';
import { checkDashToken } from '@/lib/capture/tokens';
import { tokenAskDb } from '@/lib/connector/access';
import { loadAccountSettings } from '@/lib/core/account/settings';
import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import { recordSpendReports } from '@/lib/core/spend/record';
import { askDash } from '@/lib/dash/ask';
import type { DashWriteContext } from '@/lib/dash/registry';
import { publicEnv } from '@/lib/env';
import { GOALS_SCHEMA, historyHeaders, type GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import { readMail } from '@/lib/inbox/read-mail';
import { searchMail } from '@/lib/inbox/search-mail';
import { readJobBoard } from '@/lib/jobs/discover/read-board';
import { todayInTimezone } from '@/lib/money';
import { allSearchSources } from '@/lib/search/registry';
import type { TodoSupabaseClient } from '@/lib/todo/db/schema-name';
import { insertTask } from '@/lib/todo/tasks/write';
import type { VaultSupabaseClient } from '@/lib/vault/db/schema-name';
import { noteCreatePorts } from '@/lib/vault/db/ports';
import type { CreateNotePorts } from '@/lib/vault/notes/create';
import { embedVaultNotes } from '@/lib/vault/notes/embed';
import { insertMadeChange } from './changes';
import { appendTurns, loadConversation, startAsk } from './store';
import type { VoiceAskDeps } from './voice-ask';
import { openVoiceSession } from './voice-session';

/**
 * The ask address's clients: lib/talk/voice-ask.ts's dependencies.
 *
 * The token is checked on the service role, which is the only role that may
 * run core.use_dash_token. Everything after that runs on a session as the
 * token's owner (openVoiceSession), so the lookups, the writes and the kept
 * conversation pass row level security exactly as a question asked in the
 * browser does.
 *
 * The answer is askDashInRequest's (lib/talk/ask-request.ts) with the same
 * lookups and writes, bound to that session instead of the cookies. Left out
 * are the proposals and the hand-offs, which wait on someone to confirm them
 * or read a reply later, and the page, since a spoken question has none.
 */

/** How long the embedding after a quick note is written may run, as after a save. */
const EMBED_AFTER_WRITE_MS = 20_000;

/** A goals client on the session, recording its writes in goals.history as `history` says. */
function goalsClient(accessToken: string, history: Parameters<typeof historyHeaders>[0] = {}): GoalsSupabaseClient {
  return createClient(publicEnv().NEXT_PUBLIC_SUPABASE_URL, publicEnv().NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    db: { schema: GOALS_SCHEMA },
    global: { headers: { Authorization: `Bearer ${accessToken}`, ...historyHeaders(history) } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  }) as unknown as GoalsSupabaseClient;
}

/** The note-create ports on the session's vault client, each note embedded once the reply has gone. */
function quickNotePorts(userId: string, vault: VaultSupabaseClient, core: CoreSupabaseClient): CreateNotePorts {
  return noteCreatePorts({
    supabase: vault,
    userId,
    afterSave: () => {
      after(async () => {
        try {
          await embedVaultNotes(vault, core, { userId, deadline: Date.now() + EMBED_AFTER_WRITE_MS });
        } catch (error) {
          console.error('[ask address] note embedding', error instanceof Error ? error.message : error);
        }
      });
    },
  });
}

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
        const writeWith: Omit<DashWriteContext, keyof AskContext | 'seen'> = {
          goals: async (history) => goalsClient(session.accessToken, history),
          createTask: async (owner, input, timezone) =>
            insertTask((await db('todo')) as unknown as TodoSupabaseClient, owner, input, timezone),
          quickNotePorts: async () => quickNotePorts(userId, (await db('obsidian')) as unknown as VaultSupabaseClient, core),
        };
        return await askDash(
          {
            question,
            today,
            execute: (name, args) => executeAskTool(name, args, ctx),
            // A write runs as the person, through the session's clients.
            write: (tool, args, seen) => tool.apply({ ...ctx, ...writeWith, seen }, args),
            anthropicApiKey: process.env.ANTHROPIC_API_KEY,
          },
          {
            start: (q) => startAsk(core, userId, q),
            load: (ref) => loadConversation(core, { kind: 'ask', ref }),
            append: (subject, turns) => appendTurns(core, userId, subject, turns),
            recordSpend: (reports) =>
              recordSpendReports(core, userId, { module: 'core', operation: 'ask-dash' }, reports),
            saveChange: (conversationId, made) => insertMadeChange(core, userId, conversationId, made),
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
