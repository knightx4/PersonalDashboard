import { createServiceSchemaSupabase } from '@/inngest/supabase-admin';
import { connectorAccess } from '@/lib/connector/access';
import { serveMcp } from '@/lib/connector/mcp';

/**
 * The connector's MCP endpoint (plan #1256): Claude apps call Dash's read
 * lookups here with a bearer token from Supabase's OAuth server. Public in
 * proxy.ts, since it carries that token rather than the sign-in cookie; the
 * token is checked in serveMcp before anything is read.
 *
 * The token can only read (plan #1257), so each call's log row is written
 * with the service-role client, for the verified caller's user id only.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function handle(request: Request): Promise<Response> {
  return serveMcp(request, connectorAccess, () => createServiceSchemaSupabase('core'));
}

export { handle as GET, handle as POST, handle as DELETE };
