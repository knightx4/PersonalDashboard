import { after } from 'next/server';
import { createServiceSchemaSupabase } from '@/inngest/supabase-admin';
import { createLearnServiceSupabase } from '@/inngest/learn/supabase-admin';
import { recordSpend } from '@/lib/core/spend/record';
import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import { connectorAccess } from '@/lib/connector/access';
import { serveMcp } from '@/lib/connector/mcp';
import type { ConnectorWriteContext } from '@/lib/connector/writes';

/**
 * The connector's MCP endpoint (plan #1256): Claude apps call Dash's
 * lookups here with a bearer token from Supabase's OAuth server. Public in
 * proxy.ts, since it carries that token rather than the sign-in cookie; the
 * token is checked in serveMcp before anything is read.
 *
 * The token can only read (plan #1257), so each call's log row is written
 * with the service-role client, for the verified caller's user id only. The
 * Learn writes (plan #1808) run on service-role clients made here, for that
 * same user id, and never on the token.
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

function writeContext(userId: string): ConnectorWriteContext {
  const core = createServiceSchemaSupabase('core');
  return {
    userId,
    learn: createLearnServiceSupabase(),
    core,
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
