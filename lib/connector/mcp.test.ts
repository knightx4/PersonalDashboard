import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AskToolResult } from '@/lib/ask/db';

const calls = vi.hoisted(() => ({
  checkConnectorRate: vi.fn(),
  recordConnectorCall: vi.fn(),
  executeAskTool: vi.fn(),
}));

vi.mock('./calls', () => ({
  checkConnectorRate: calls.checkConnectorRate,
  recordConnectorCall: calls.recordConnectorCall,
}));

vi.mock('@/lib/ask/tools', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/ask/tools')>()),
  executeAskTool: calls.executeAskTool,
}));

import { ASK_TOOLS, ASK_TOOL_NAMES } from '@/lib/ask/tools';
import type { ConnectorAccess } from './access';
import { protectedResourceResponse, serveMcp } from './mcp';
import { refusal } from './token';

/**
 * The connector's MCP endpoint (plan #1256), driven through the real
 * mcp-handler and MCP server with a stubbed token check, cap, log and lookup.
 */

const HOST = 'https://dash.example.com';
const METADATA = `${HOST}/.well-known/oauth-protected-resource/api/mcp`;
const core = { name: 'core client' };
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
    const response = await serveMcp(mcpRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, null), access);

    expect(response.status).toBe(401);
    expect(access).toHaveBeenCalledWith(null);
    expect(response.headers.get('www-authenticate')).toBe(`Bearer resource_metadata="${METADATA}"`);
    expect(calls.executeAskTool).not.toHaveBeenCalled();
  });

  it('names the token as invalid when one was sent and refused', async () => {
    const response = await serveMcp(
      mcpRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, 'Bearer browser-session'),
      async () => refusal('not_connector'),
    );

    expect(response.status).toBe(401);
    const header = response.headers.get('www-authenticate') ?? '';
    expect(header).toMatch(/^Bearer error="invalid_token", error_description="[^"]+"/);
    expect(header).toContain(`resource_metadata="${METADATA}"`);
  });
});

describe('the tool list', () => {
  it('offers the seven Ask Dash lookups with their own descriptions and schemas, read only', async () => {
    await call('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test', version: '1' },
    });
    const { tools } = (await call('tools/list')) as {
      tools: { name: string; description: string; inputSchema: Record<string, unknown>; annotations: Record<string, unknown> }[];
    };

    expect(tools.map((t) => t.name)).toEqual([...ASK_TOOL_NAMES]);
    for (const tool of tools) {
      const ask = ASK_TOOLS.find((t) => t.name === tool.name)!;
      expect(tool.description).toBe(ask.description);
      expect(tool.inputSchema).toMatchObject(ask.input_schema);
      expect(tool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    }
  });
});

describe('a tool call', () => {
  it('checks the cap, runs the lookup as the token holder and logs the call once', async () => {
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
    expect(calls.recordConnectorCall).toHaveBeenCalledWith(core, {
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
    expect(calls.recordConnectorCall).toHaveBeenCalledWith(core, {
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
