import { fromJsonSchema, type CallToolResult, type McpServer } from '@modelcontextprotocol/server';
import { createMcpHandler, generateProtectedResourceMetadata, getPublicOrigin } from 'mcp-handler';
import type { AskToolResult, SchemaClient } from '@/lib/ask/db';
import { IN_APP_ONLY_TOOLS, executeAskTool } from '@/lib/ask/tools';
import { dashToolsOf } from '@/lib/dash/registry';
import type { ConnectorAccess } from './access';
import { checkConnectorRate, recordConnectorCall, type ConnectorCall } from './calls';
import type { ConnectorRefusal } from './token';

/**
 * The connector's MCP server (plan #1256): Dash's read lookups offered
 * to a Claude app over Streamable HTTP at /api/mcp, stateless, one server per
 * request. The route verifies the token with connectorAccess() and hands the
 * result in here; every tool call is then capped, run and logged as the
 * token's holder.
 *
 * Nothing here reads the environment or makes a client, so the tests drive
 * the whole handler with a stubbed access and a stubbed database.
 */

export const MCP_PATH = '/api/mcp';
const METADATA_PATH = '/.well-known/oauth-protected-resource';

/** The paths the protected resource metadata is served at: the one the 401 names, and the bare one clients fall back to. */
export const RESOURCE_METADATA_PATHS = [`${METADATA_PATH}${MCP_PATH}`, METADATA_PATH] as const;

/** The server's resource identifier (RFC 9728): the MCP endpoint's own URL. */
export function resourceUrl(origin: string): string {
  return `${origin}${MCP_PATH}`;
}

/** Where the 401 tells a client to read how this server signs in. */
export function resourceMetadataUrl(origin: string): string {
  return `${origin}${RESOURCE_METADATA_PATHS[0]}`;
}

function quoted(value: string): string {
  return `"${value.replace(/["\\]/g, '')}"`;
}

/**
 * The 401 for a request without a usable token. The WWW-Authenticate header
 * is what sends a client to the metadata, and from there to the sign-in; a
 * missing token gets no error code, as RFC 6750 asks.
 */
export function unauthorizedResponse(origin: string, refusal: ConnectorRefusal): Response {
  const params = [
    ...(refusal.reason === 'missing'
      ? []
      : [`error="invalid_token"`, `error_description=${quoted(refusal.error)}`]),
    `resource_metadata=${quoted(resourceMetadataUrl(origin))}`,
  ];
  return Response.json(
    { error: refusal.reason === 'missing' ? 'unauthorized' : 'invalid_token', error_description: refusal.error },
    {
      status: 401,
      headers: { 'WWW-Authenticate': `Bearer ${params.join(', ')}`, 'Cache-Control': 'no-store' },
    },
  );
}

const METADATA_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Cache-Control': 'max-age=3600',
};

/**
 * The protected resource metadata (RFC 9728): this server's identifier and
 * the Supabase auth server that issues its tokens. `authServer` is the
 * issuer, `https://<ref>.supabase.co/auth/v1`, whose own metadata lives at
 * /.well-known/oauth-authorization-server/auth/v1 on that host.
 */
export function protectedResourceResponse(request: Request, authServer: string): Response {
  const metadata = generateProtectedResourceMetadata({
    authServerUrls: [authServer],
    resourceUrl: resourceUrl(getPublicOrigin(request)),
    additionalMetadata: { resource_name: 'Dash', bearer_methods_supported: ['header'] },
  });
  return Response.json(metadata, { headers: METADATA_HEADERS });
}

export function metadataOptionsResponse(): Response {
  return new Response(null, { status: 204, headers: { ...METADATA_HEADERS, 'Access-Control-Max-Age': '86400' } });
}

/**
 * A verified caller, as the tool calls need it: what connectorAccess built on
 * the token, plus `log`, the service-role core client its calls are recorded
 * through.
 */
export type ConnectorSession = Extract<ConnectorAccess, { ok: true }> & { log: SchemaClient };

/** A lookup's result with each link made absolute, so it opens from wherever the client shows it. */
function withAbsoluteLinks(result: Extract<AskToolResult, { ok: true }>, origin: string) {
  return { ...result, rows: result.rows.map((row) => ({ ...row, href: `${origin}${row.href}` })) };
}

function text(value: string, isError = false): CallToolResult {
  return { content: [{ type: 'text', text: value }], ...(isError ? { isError: true } : {}) };
}

/**
 * The one place a connector call is written to the log. The token itself
 * cannot write (plan #1257: the database makes any request carrying a
 * client_id claim read-only), so the row goes in through `log`, the
 * service-role core client the route hands over. That client passes no RLS,
 * so the row's user is the verified caller's and nothing the client sent.
 */
function logCall(log: SchemaClient, call: ConnectorCall): Promise<void> {
  return recordConnectorCall(log, call);
}

/**
 * One tool call: the cap first, then the lookup, then the log. A refused or
 * failed call is still logged, and comes back as a tool error the model can
 * read. A failed log write throws, so no call is answered unrecorded.
 */
export async function runConnectorTool(
  session: ConnectorSession,
  tool: string,
  input: unknown,
  origin: string,
  now?: number,
): Promise<CallToolResult> {
  const { caller, core, ctx, log } = session;
  const who = { userId: caller.userId, clientId: caller.clientId, tool, input };

  const rate = await checkConnectorRate(core, caller.userId, now);
  if (!rate.ok) {
    await logCall(log, { ...who, limited: rate.message });
    return text(rate.message, true);
  }

  const result = (IN_APP_ONLY_TOOLS as readonly string[]).includes(tool)
    ? ({ ok: false, error: `There is no tool called ${tool}.` } as const)
    : await executeAskTool(tool, input, ctx);
  await logCall(log, { ...who, result });
  return result.ok ? text(JSON.stringify(withAbsoluteLinks(result, origin))) : text(result.error, true);
}

/** Where the verified session rides from the route to the tool calls. */
const SESSION_KEY = 'connectorSession';

function sessionOf(extra: Record<string, unknown> | undefined): ConnectorSession {
  const session = extra?.[SESSION_KEY] as ConnectorSession | undefined;
  // The route only calls the handler with a verified session; reaching here without one is a bug.
  if (!session) throw new Error('The connector call arrived without a verified token.');
  return session;
}

/** The lookups the connector offers: every lookup in Dash's registry but the ones kept in the app. */
export const CONNECTOR_TOOLS = dashToolsOf('lookup')
  .filter((tool) => !tool.inAppOnly)
  .map((tool) => tool.definition);

/** The lookups as MCP tools, with Ask Dash's own descriptions and input schemas. */
export function registerAskTools(server: McpServer): void {
  for (const tool of CONNECTOR_TOOLS) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: fromJsonSchema<Record<string, unknown>>(tool.input_schema as Parameters<typeof fromJsonSchema>[0]),
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
      async (args, ctx) => {
        const origin = ctx.http?.req ? getPublicOrigin(ctx.http.req) : '';
        return runConnectorTool(sessionOf(ctx.http?.authInfo?.extra), tool.name, args, origin);
      },
    );
  }
}

const handler = createMcpHandler(registerAskTools, {
  serverInfo: { name: 'Dash', version: '1.0.0' },
  instructions:
    "Read-only lookups over the person's own dashboard: their orders and spending, job applications, todos, goals, Obsidian vault notes, and what they have written about a topic anywhere in it. Every row comes back with a link to its page in the dashboard.",
});

/**
 * Answer one request to /api/mcp. `access` is connectorAccess on the request's
 * Authorization header; a refusal is the 401 that starts the sign-in. `log`
 * makes the service-role core client the calls are recorded through, and is
 * only called once the token has been verified.
 */
export async function serveMcp(
  request: Request,
  access: (authorization: string | null) => Promise<ConnectorAccess>,
  log: () => SchemaClient,
): Promise<Response> {
  const origin = getPublicOrigin(request);
  const granted = await access(request.headers.get('authorization'));
  if (!granted.ok) return unauthorizedResponse(origin, granted);
  const verdict: ConnectorSession = { ...granted, log: log() };

  request.auth = {
    token: '',
    clientId: verdict.caller.clientId,
    scopes: [],
    resource: new URL(resourceUrl(origin)),
    extra: { [SESSION_KEY]: verdict },
  };
  return handler(request);
}
