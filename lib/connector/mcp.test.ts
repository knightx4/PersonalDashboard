import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AskToolResult } from '@/lib/ask/db';

const calls = vi.hoisted(() => ({
  checkConnectorRate: vi.fn(),
  recordConnectorCall: vi.fn(),
  executeAskTool: vi.fn(),
  runConnectorWrite: vi.fn(),
}));

vi.mock('./calls', () => ({
  checkConnectorRate: calls.checkConnectorRate,
  recordConnectorCall: calls.recordConnectorCall,
}));

vi.mock('@/lib/ask/tools', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/ask/tools')>()),
  executeAskTool: calls.executeAskTool,
}));

vi.mock('./writes', async (importActual) => ({
  ...(await importActual<typeof import('./writes')>()),
  runConnectorWrite: calls.runConnectorWrite,
}));

import { ASK_TOOLS, ASK_TOOL_NAMES } from '@/lib/ask/tools';
import { CONNECTOR_WRITE_TOOLS } from './writes';
import type { ConnectorAccess } from './access';
import { protectedResourceResponse, serveMcp } from './mcp';
import { refusal } from './token';

/**
 * The connector's MCP endpoint (plan #1256), driven through the real
 * mcp-handler and MCP server with a stubbed token check, cap, log and lookup.
 */

const HOST = 'https://dash.example.com';
const LOOKUP_NAMES: string[] = ASK_TOOL_NAMES.filter(
  (name) => name !== 'search_mail' && name !== 'read_mail' && name !== 'show_chart',
);
const WRITE_NAMES = CONNECTOR_WRITE_TOOLS.map((tool) => tool.definition.name);
const METADATA = `${HOST}/.well-known/oauth-protected-resource/api/mcp`;
const core = { name: 'core client' };
/** The service-role client the log is written through: the token cannot write (plan #1257). */
const logClient = { name: 'service-role core client' };
const makeLog = vi.fn(() => logClient as never);
const ctx = { userId: 'me' };
const session: ConnectorAccess = {
  ok: true,
  caller: { userId: 'me', clientId: 'claude-client', issuedAt: 1 },
  core: core as never,
  ctx: ctx as never,
};

let rpcId = 0;
function mcpRequest(body: unknown, authorization: string | null = 'Bearer good'): Request {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    'mcp-protocol-version': '2025-06-18',
    'x-forwarded-host': 'dash.example.com',
    'x-forwarded-proto': 'https',
  };
  if (authorization) headers.authorization = authorization;
  return new Request('http://localhost:3000/api/mcp', { method: 'POST', headers, body: JSON.stringify(body) });
}

/** The JSON-RPC result of a response, whether it came as JSON or as one server-sent event. */
async function rpcResult(response: Response): Promise<Record<string, unknown>> {
  const raw = await response.text();
  const json = response.headers.get('content-type')?.includes('text/event-stream')
    ? raw
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
        .join('')
    : raw;
  const message = JSON.parse(json);
  if (message.error) throw new Error(JSON.stringify(message.error));
  return message.result;
}

async function call(method: string, params: Record<string, unknown> = {}) {
  const response = await serveMcp(
    mcpRequest({ jsonrpc: '2.0', id: ++rpcId, method, params }),
    async () => session,
    makeLog,
  );
  expect(response.status).toBe(200);
  return rpcResult(response);
}

beforeEach(() => {
  vi.clearAllMocks();
  calls.checkConnectorRate.mockResolvedValue({ ok: true });
  calls.recordConnectorCall.mockResolvedValue(undefined);
});

describe('a request without a usable token', () => {
  it('answers 401 pointing at the resource metadata, and never reads', async () => {
    const access = vi.fn(async () => refusal('missing'));
    const response = await serveMcp(mcpRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, null), access, makeLog);

    expect(response.status).toBe(401);
    expect(access).toHaveBeenCalledWith(null);
    expect(response.headers.get('www-authenticate')).toBe(`Bearer resource_metadata="${METADATA}"`);
    expect(calls.executeAskTool).not.toHaveBeenCalled();
    expect(makeLog).not.toHaveBeenCalled();
  });

  it('names the token as invalid when one was sent and refused', async () => {
    const response = await serveMcp(
      mcpRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, 'Bearer browser-session'),
      async () => refusal('not_connector'),
      makeLog,
    );

    expect(response.status).toBe(401);
    const header = response.headers.get('www-authenticate') ?? '';
    expect(header).toMatch(/^Bearer error="invalid_token", error_description="[^"]+"/);
    expect(header).toContain(`resource_metadata="${METADATA}"`);
  });
});

describe('the tool list', () => {
  it('offers every Ask Dash lookup but mail search and the chart, read only, then the Learn writes', async () => {
    await call('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test', version: '1' },
    });
    const { tools } = (await call('tools/list')) as {
      tools: { name: string; description: string; inputSchema: Record<string, unknown>; annotations: Record<string, unknown> }[];
    };

    expect(tools.map((t) => t.name)).toEqual([...LOOKUP_NAMES, ...WRITE_NAMES]);
    for (const tool of tools.filter((t) => LOOKUP_NAMES.includes(t.name))) {
      const ask = ASK_TOOLS.find((t) => t.name === tool.name)!;
      expect(tool.description).toBe(ask.description);
      expect(tool.inputSchema).toMatchObject(ask.input_schema);
      expect(tool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    }
    for (const tool of tools.filter((t) => WRITE_NAMES.includes(t.name))) {
      expect(tool.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });
    }
  });
});

describe('a subscription request', () => {
  /** A 2026-07-28 request, which carries its protocol version in the body as well as the header. */
  function modernRequest(method: string, params: Record<string, unknown>): Request {
    return new Request('http://localhost:3000/api/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2026-07-28',
        'mcp-method': method,
        authorization: 'Bearer good',
        'x-forwarded-host': 'dash.example.com',
        'x-forwarded-proto': 'https',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: ++rpcId,
        method,
        params: {
          ...params,
          _meta: {
            'io.modelcontextprotocol/protocolVersion': '2026-07-28',
            'io.modelcontextprotocol/clientInfo': { name: 'test', version: '1' },
            'io.modelcontextprotocol/clientCapabilities': {},
          },
        },
      }),
    });
  }

  it('acknowledges a listen for tool list changes and closes, since the list never changes', async () => {
    const response = await serveMcp(
      modernRequest('subscriptions/listen', { notifications: { toolsListChanged: true } }),
      async () => session,
      makeLog,
    );
    expect(response.status).toBe(200);

    // The whole body arrives and ends: a stream left open runs the function to its time limit.
    const ended = await Promise.race([
      response.text().then((text) => ({ text })),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 1_000)),
    ]);
    expect(ended).not.toBeNull();
    const frames = ended!.text
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => JSON.parse(line.slice(5)));
    expect(frames[0]).toMatchObject({ method: 'notifications/subscriptions/acknowledged', params: { notifications: {} } });
    expect(frames.at(-1)).toMatchObject({ result: { resultType: 'complete' } });
  });

  it('still answers a modern tools/list with every lookup', async () => {
    const response = await serveMcp(modernRequest('tools/list', {}), async () => session, makeLog);
    expect(response.status).toBe(200);
    const { tools } = (await rpcResult(response)) as { tools: { name: string }[] };
    expect(tools.map((tool) => tool.name)).toEqual([...LOOKUP_NAMES, ...WRITE_NAMES]);
  });
});

describe('a tool call', () => {
  it('checks the cap and runs the lookup as the token holder, and logs the call once through the service-role client', async () => {
    const result: AskToolResult = {
      ok: true,
      rows: [{ table: 'core.todos', ref: 't1', title: 'Call the bank', href: '/todo?task=t1' }],
    };
    calls.executeAskTool.mockResolvedValue(result);

    const answer = (await call('tools/call', { name: 'todos', arguments: { from: '2026-09-01' } })) as {
      content: { text: string }[];
      isError?: boolean;
    };

    expect(calls.checkConnectorRate).toHaveBeenCalledWith(core, 'me', undefined);
    expect(calls.executeAskTool).toHaveBeenCalledWith('todos', { from: '2026-09-01' }, ctx);
    expect(calls.recordConnectorCall).toHaveBeenCalledTimes(1);
    expect(calls.recordConnectorCall).toHaveBeenCalledWith(logClient, {
      userId: 'me',
      clientId: 'claude-client',
      tool: 'todos',
      input: { from: '2026-09-01' },
      result,
    });
    expect(answer.isError).toBeUndefined();
    expect(JSON.parse(answer.content[0].text).rows[0].href).toBe(`${HOST}/todo?task=t1`);
  });

  it('refuses a call over the cap without running it, and logs the refusal', async () => {
    const message = 'Too many calls: the dashboard answers at most 30 calls a minute from connected apps. Try again in 20 seconds.';
    calls.checkConnectorRate.mockResolvedValue({
      ok: false,
      limit: 'minute',
      retryAt: '2026-09-30T12:00:20.000Z',
      retryAfterSeconds: 20,
      message,
    });

    const answer = (await call('tools/call', { name: 'todos', arguments: {} })) as {
      content: { text: string }[];
      isError?: boolean;
    };

    expect(calls.executeAskTool).not.toHaveBeenCalled();
    expect(calls.recordConnectorCall).toHaveBeenCalledWith(logClient, {
      userId: 'me',
      clientId: 'claude-client',
      tool: 'todos',
      input: {},
      limited: message,
    });
    expect(answer).toMatchObject({ isError: true, content: [{ text: message }] });
  });

  it('hands a lookup error back as a tool error, logged', async () => {
    calls.executeAskTool.mockResolvedValue({ ok: false, error: 'The Todo workspace is switched off, so it cannot be read.' });

    const answer = (await call('tools/call', { name: 'todos', arguments: {} })) as {
      content: { text: string }[];
      isError?: boolean;
    };

    expect(calls.recordConnectorCall).toHaveBeenCalledTimes(1);
    expect(answer).toMatchObject({ isError: true, content: [{ text: 'The Todo workspace is switched off, so it cannot be read.' }] });
  });
});

describe('a write call', () => {
  const writeCtx = { userId: 'me', name: 'service-role learn context' };
  const makeWrite = vi.fn(() => writeCtx as never);

  async function write(name: string, args: Record<string, unknown>, withWrite = true) {
    const response = await serveMcp(
      mcpRequest({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } }),
      async () => session,
      makeLog,
      withWrite ? makeWrite : undefined,
    );
    expect(response.status).toBe(200);
    return (await rpcResult(response)) as { content: { text: string }[]; isError?: boolean };
  }

  it('runs on the service-role context for the verified person, never the token, and is logged once', async () => {
    const result: AskToolResult = {
      ok: true,
      rows: [{ table: 'learn.readings', ref: 'r1', title: 'Building Effective Agents', href: '/learn/r/r1' }],
    };
    calls.runConnectorWrite.mockResolvedValue(result);

    const answer = await write('add_to_reading_list', { items: [{ title: 'Building Effective Agents' }], subjects: ['AI agents'] });

    expect(calls.checkConnectorRate).toHaveBeenCalledWith(core, 'me', undefined);
    expect(makeWrite).toHaveBeenCalledWith('me');
    expect(calls.runConnectorWrite.mock.calls[0][0].definition.name).toBe('add_to_reading_list');
    expect(calls.runConnectorWrite.mock.calls[0][1]).toBe(writeCtx);
    expect(calls.executeAskTool).not.toHaveBeenCalled();
    expect(calls.recordConnectorCall).toHaveBeenCalledTimes(1);
    expect(calls.recordConnectorCall).toHaveBeenCalledWith(logClient, expect.objectContaining({ tool: 'add_to_reading_list', result }));
    expect(JSON.parse(answer.content[0].text).rows[0].href).toBe(`${HOST}/learn/r/r1`);
  });

  it('is refused, and logged, when the route gave no way to write', async () => {
    const answer = await write('mark_read', { title: 'agents' }, false);

    expect(calls.runConnectorWrite).not.toHaveBeenCalled();
    expect(calls.recordConnectorCall).toHaveBeenCalledTimes(1);
    expect(answer).toMatchObject({ isError: true, content: [{ text: 'Changes cannot be made through this connection.' }] });
  });

  it('is capped like a lookup', async () => {
    calls.checkConnectorRate.mockResolvedValue({ ok: false, limit: 'minute', retryAt: '', retryAfterSeconds: 20, message: 'Too many calls.' });

    const answer = await write('log_learning', { topic: 'Evals', summary: 'x', subject: 'Evals' });

    expect(calls.runConnectorWrite).not.toHaveBeenCalled();
    expect(answer).toMatchObject({ isError: true, content: [{ text: 'Too many calls.' }] });
  });
});

describe('the protected resource metadata', () => {
  it('names /api/mcp as the resource and the Supabase auth server as where to sign in', async () => {
    const request = new Request('http://localhost:3000/.well-known/oauth-protected-resource/api/mcp', {
      headers: { 'x-forwarded-host': 'dash.example.com', 'x-forwarded-proto': 'https' },
    });
    const response = protectedResourceResponse(request, 'https://ref.supabase.co/auth/v1');

    expect(await response.json()).toMatchObject({
      resource: `${HOST}/api/mcp`,
      authorization_servers: ['https://ref.supabase.co/auth/v1'],
    });
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
  });
});
