import { describe, expect, it, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { PEOPLE_TOOLS } from '@/lib/you/people-actions';
import { MENTOR_LOOKUPS } from '@/lib/you/mentor-reply';
import { runDash, voiceTools, type DashContext, type DashVoice } from './loop';
import { dashTool } from './registry';
import { BOT_LOADED, OPEN_AREA_TOOL, openArea, TOOL_AREAS, toolBranches } from './tool-areas';

/**
 * People bots load most of their tools by area (lib/dash/tool-areas.ts):
 * every tool has one place, the deferred ones are sent marked, and opening an
 * area returns its tools as tool_reference blocks.
 */

describe('the tool areas', () => {
  const names = new Set(PEOPLE_TOOLS.map((tool) => tool.name));

  it('gives every bot tool exactly one place: always loaded or in one area', () => {
    const places = new Map<string, number>();
    for (const name of [...BOT_LOADED, ...TOOL_AREAS.flatMap((area) => area.tools)]) {
      places.set(name, (places.get(name) ?? 0) + 1);
    }
    expect([...names].filter((name) => !places.has(name))).toEqual([]);
    expect([...places].filter(([, count]) => count > 1).map(([name]) => name)).toEqual([]);
  });

  it('names no tool the bots do not have', () => {
    const named = [...BOT_LOADED, ...TOOL_AREAS.flatMap((area) => area.tools)];
    expect(named.filter((name) => !names.has(name))).toEqual([]);
  });

  it('defers every area tool and keeps the everyday ones loaded', () => {
    const branches = toolBranches(PEOPLE_TOOLS);
    for (const name of BOT_LOADED) expect(branches.deferred.has(name)).toBe(false);
    expect(branches.deferred.has('change_goal_step')).toBe(true);
    expect(branches.deferred.size).toBe(PEOPLE_TOOLS.length - BOT_LOADED.length);
  });

  it('keeps a lookup-only bot to the areas that hold its lookups', () => {
    const branches = toolBranches(MENTOR_LOOKUPS);
    const keys = branches.areas.map((area) => area.key);
    expect(keys).toContain('money');
    expect(keys).not.toContain('shopping');
    for (const area of branches.areas) {
      for (const name of area.tools) expect(dashTool(name)?.kind).toBe('lookup');
    }
  });

  it('opens an area as tool_reference blocks, and names the areas for a wrong key', () => {
    const branches = toolBranches(PEOPLE_TOOLS);
    const opened = openArea(branches, { area: 'money' });
    expect(opened).toEqual({
      ok: true,
      key: 'money',
      blocks: ['spend_by_merchant', 'accounts', 'balance_history', 'change_recurring'].map((tool_name) => ({
        type: 'tool_reference',
        tool_name,
      })),
    });
    const wrong = openArea(branches, { area: 'garden' });
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.error).toContain('goals');
  });
});

describe('a voice with branches', () => {
  const tools = PEOPLE_TOOLS;
  const voice: DashVoice = { model: 'test-model', system: 'Rules.', tools, branches: toolBranches(tools), cacheTtl: '1h' };

  it('sends the deferred tools marked, open_area before the last tool, and the 1-hour breakpoint on it', () => {
    const sent = voiceTools(voice) as (Anthropic.Tool & { defer_loading?: boolean; cache_control?: { ttl?: string } })[];
    const byName = new Map(sent.map((tool) => [tool.name, tool]));
    expect(byName.get('change_goal_step')?.defer_loading).toBe(true);
    expect(byName.get('add_todo')?.defer_loading).toBeUndefined();
    expect(sent[sent.length - 2].name).toBe(OPEN_AREA_TOOL);
    const last = sent[sent.length - 1];
    expect(last.defer_loading).toBeUndefined();
    expect(last.cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
    expect(sent.filter((tool) => tool.cache_control && tool.defer_loading)).toEqual([]);
  });

  it('sends a voice without branches as before', () => {
    const sent = voiceTools({ model: 'test-model', system: 'Rules.', tools }) as (Anthropic.Tool & { defer_loading?: boolean })[];
    expect(sent.some((tool) => tool.defer_loading)).toBe(false);
    expect(sent.some((tool) => tool.name === OPEN_AREA_TOOL)).toBe(false);
  });

  it('answers open_area with its tools as tool_reference blocks and runs the tool called next', async () => {
    const usage = { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
    const replies = [
      { content: [{ type: 'tool_use', id: 'o1', name: OPEN_AREA_TOOL, input: { area: 'money' } }], stop_reason: 'tool_use', usage },
      { content: [{ type: 'tool_use', id: 'l1', name: 'accounts', input: {} }], stop_reason: 'tool_use', usage },
      { content: [{ type: 'tool_use', id: 'a1', name: 'answer', input: { answer: 'You have two accounts.', cited: [] } }], stop_reason: 'tool_use', usage },
    ];
    const sent: { system: { cache_control?: unknown }[]; messages: { role: string; content: unknown }[] }[] = [];
    const client = {
      messages: {
        create: async (params: (typeof sent)[number]) => {
          sent.push(structuredClone(params));
          return replies[sent.length - 1];
        },
      },
    } as unknown as Anthropic;
    const execute = vi.fn(async () => ({ ok: true as const, rows: [] }));
    const context: DashContext = { surface: 'thread', subject: null, page: null };
    const answer = await runDash({
      voice,
      context,
      turns: [{ role: 'user', body: 'What accounts do I have?' }],
      today: '2026-11-10',
      execute,
      anthropicApiKey: 'k',
      client,
    });
    expect(answer.ok).toBe(true);
    expect(execute).toHaveBeenCalledWith('accounts', {});
    const opened = sent[1].messages[sent[1].messages.length - 1].content as { type: string; content: unknown }[];
    expect(opened[0].type).toBe('tool_result');
    expect(opened[0].content).toEqual(
      ['spend_by_merchant', 'accounts', 'balance_history', 'change_recurring'].map((tool_name) => ({ type: 'tool_reference', tool_name })),
    );
    expect(sent[0].system[0].cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
  });

  it('sends every tool, once, when the API refuses the request with deferred tools', async () => {
    const usage = { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
    const sent: { tools: { name: string; defer_loading?: boolean }[] }[] = [];
    const client = {
      messages: {
        create: async (params: (typeof sent)[number]) => {
          sent.push(structuredClone(params));
          if (sent.length === 1) throw Object.assign(new Error('tool_reference is not supported'), { status: 400 });
          return { content: [{ type: 'tool_use', id: 'a1', name: 'answer', input: { answer: 'Hi.', cited: [] } }], stop_reason: 'tool_use', usage };
        },
      },
    } as unknown as Anthropic;
    const answer = await runDash({
      voice,
      context: { surface: 'thread', subject: null, page: null },
      turns: [{ role: 'user', body: 'Hi' }],
      today: '2026-11-10',
      execute: vi.fn(),
      anthropicApiKey: 'k',
      client,
    });
    expect(answer.ok).toBe(true);
    expect(sent).toHaveLength(2);
    expect(sent[0].tools.some((tool) => tool.defer_loading)).toBe(true);
    expect(sent[1].tools.some((tool) => tool.defer_loading || tool.name === OPEN_AREA_TOOL)).toBe(false);
  });
});
