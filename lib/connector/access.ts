import 'server-only';

import { createClient } from '@supabase/supabase-js';
import type { AskContext, AskDb, AskSchema, SchemaClient } from '@/lib/ask/db';
import { loadAccountSettings } from '@/lib/core/account/settings';
import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import { publicEnv } from '@/lib/env';
import { todayInTimezone } from '@/lib/money';
import { allSearchSources } from '@/lib/search/registry';
import { lastConnectorRevocation } from './calls';
import {
  authIssuer,
  bearerToken,
  refusal,
  verifyConnectorToken,
  type ConnectorCaller,
  type ConnectorRefusal,
} from './token';

/**
 * Dash's lookups for a request that carries a connector's token instead of the
 * sign-in cookie (plan #1255). The route at /api/mcp calls connectorAccess()
 * once per request and runs every tool call on the context it returns.
 *
 * Each schema's client is made with the token in the Authorization header, so
 * the database sees the same person, and row level security the same rules,
 * as it does for Ask Dash in the browser. The anon key is only the API key.
 */

/** A supabase-js client for one schema, acting as the token's holder. */
function tokenClient(token: string, schema: AskSchema): SchemaClient {
  return createClient(publicEnv().NEXT_PUBLIC_SUPABASE_URL, publicEnv().NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    db: { schema },
    global: { headers: { Authorization: `Bearer ${token}` } },
    // No storage and no refresh: the token is the caller's, and it is all there is.
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  }) as SchemaClient;
}

/** The lookups' clients for a bearer token, each made the first time a lookup asks for its schema. */
export function tokenAskDb(token: string): AskDb {
  const made = new Map<AskSchema, SchemaClient>();
  return async (schema) => {
    let client = made.get(schema);
    if (!client) {
      client = tokenClient(token, schema);
      made.set(schema, client);
    }
    return client;
  };
}

export type ConnectorAccess =
  | {
      ok: true;
      caller: ConnectorCaller;
      /** Everything executeAskTool needs, as the token's holder. */
      ctx: AskContext;
      /** The core-schema client on the token, for checkConnectorRate and recordConnectorCall. */
      core: SchemaClient;
    }
  | ConnectorRefusal;

/**
 * Verify the request's `Authorization` header and build the lookup context,
 * or say why not. A refusal is always a 401 to the client. Throws only when
 * the database cannot be read (the revocations or the settings), which is a
 * 500: a token is never let through because a check could not run.
 */
export async function connectorAccess(authorization: string | null): Promise<ConnectorAccess> {
  const token = bearerToken(authorization);
  if (!token) return refusal('missing');
  const db = tokenAskDb(token);
  const core = await db('core');

  const verdict = await verifyConnectorToken(token, {
    getClaims: (jwt) => core.auth.getClaims(jwt),
    issuer: authIssuer(publicEnv().NEXT_PUBLIC_SUPABASE_URL),
    lastRevocation: (userId, clientId) => lastConnectorRevocation(core, userId, clientId),
  });
  if (!verdict.ok) return verdict;

  const { caller } = verdict;
  const settings = await loadAccountSettings(caller.userId, core as unknown as CoreSupabaseClient);
  return {
    ok: true,
    caller,
    core,
    ctx: {
      userId: caller.userId,
      today: todayInTimezone(settings.timezone),
      enabledModules: settings.enabledModules,
      db,
      searchSources: allSearchSources(),
    },
  };
}
