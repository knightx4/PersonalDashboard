import { after } from 'next/server';
import { createServiceSchemaSupabase } from '@/inngest/supabase-admin';
import { createLearnServiceSupabase } from '@/inngest/learn/supabase-admin';
import { createVaultServiceSupabase } from '@/inngest/vault/supabase-admin';
import type { AskDb, AskSchema, SchemaClient } from '@/lib/ask/db';
import { recordSpend } from '@/lib/core/spend/record';
import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import { connectorAccess } from '@/lib/connector/access';
import { serveMcp } from '@/lib/connector/mcp';
import type { ConnectorWriteContext } from '@/lib/connector/writes';
import type { QuickNoteFiled } from '@/lib/dash/registry';
import { noteCreatePorts } from '@/lib/vault/db/ports';
import { createCapturedNote } from '@/lib/vault/notes/create';
import { embedVaultNotes } from '@/lib/vault/notes/embed';

/**
 * The connector's MCP endpoint (plan #1256): Claude apps call Dash's
 * lookups here with a bearer token from Supabase's OAuth server. Public in
 * proxy.ts, since it carries that token rather than the sign-in cookie; the
 * token is checked in serveMcp before anything is read.
 *
 * The token can only read (plan #1257), so each call's log row is written
 * with the service-role client, for the verified caller's user id only. The
 * writes (Learn's, plan #1808, and a quick note, an idea or a job lead, plan
 * #1894.2) run on service-role clients made here, for that same user id, and
 * never on the token.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/**
 * A lookup answers in seconds, and a listen stream is closed as soon as it is
 * acknowledged (lib/connector/mcp.ts). The limit is set by add_to_reading_list,
 * which looks up where each work can be read after its reply has gone: up to
 * LOOKUP_MS of web-searching calls run in `after`, inside this limit.
 */
export const maxDuration = 300;

/** How long the lookups after a reply may run; the hourly tick finishes the rest. */
const LOOKUP_MS = 240_000;

/** How long the embedding after a quick note is written may run, as after a save. */
const EMBED_AFTER_WRITE_MS = 20_000;

/** The service-role client per schema, each made once per call. Every write through it names the user. */
function serviceAskDb(): AskDb {
  const made = new Map<AskSchema, SchemaClient>();
  return async (schema) => {
    let client = made.get(schema);
    if (!client) {
      client = createServiceSchemaSupabase(schema);
      made.set(schema, client);
    }
    return client;
  };
}

/**
 * A quick note in the person's vault Inbox, as the capture address writes one
 * (lib/capture/address-server.ts): the connection opened by user id, since the
 * service role passes no RLS, and the note embedded once the reply has gone.
 */
async function fileQuickNote(userId: string, core: SchemaClient, text: string): Promise<QuickNoteFiled> {
  const vault = createVaultServiceSupabase();
  const ports = noteCreatePorts({
    supabase: vault,
    userId,
    afterSave: () => {
      after(async () => {
        try {
          await embedVaultNotes(vault, core as unknown as CoreSupabaseClient, { userId, deadline: Date.now() + EMBED_AFTER_WRITE_MS });
        } catch (error) {
          console.error('[connector write] note embedding', error instanceof Error ? error.message : error);
        }
      });
    },
  });
  const result = await createCapturedNote(ports, text);
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, noteId: result.noteId, path: result.path, title: result.title, blobSha: result.blobSha };
}

function writeContext(userId: string): ConnectorWriteContext {
  const core = createServiceSchemaSupabase('core');
  return {
    userId,
    learn: createLearnServiceSupabase(),
    core,
    db: serviceAskDb(),
    fileQuickNote: (text) => fileQuickNote(userId, core, text),
    later: (work) => after(work),
    recordSpend: async (owner, operation, reports) => {
      for (const report of reports) {
        await recordSpend(core as unknown as CoreSupabaseClient, owner, {
          module: 'learn',
          operation,
          model: report.model,
          usage: report.usage,
        }).catch((error) => console.error('[connector write] spend', error instanceof Error ? error.message : error));
      }
    },
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    lookupDeadline: Date.now() + LOOKUP_MS,
  };
}

function handle(request: Request): Promise<Response> {
  return serveMcp(request, connectorAccess, () => createServiceSchemaSupabase('core'), writeContext);
}

export { handle as GET, handle as POST, handle as DELETE };
