import { describe, expect, it } from 'vitest';
import { ASK_TOOLS, ASK_TOOL_NAMES, IN_APP_ONLY_TOOLS } from '@/lib/ask/tools';
import { PROPOSAL_TOOL_NAMES } from '@/lib/ask/propose';
import { HAND_OFF_TOOL_NAME } from '@/lib/talk/handoff';
import { DASH_TOOLS, dashTool, dashToolsOf } from './registry';

/** Dash's one tool registry (plan #1463): every tool Ask had, each declared once. */
describe('DASH_TOOLS', () => {
  it('lists every lookup, every proposal and the hand-off, in the order Ask sent them', () => {
    expect(DASH_TOOLS.map((t) => t.name)).toEqual([...ASK_TOOL_NAMES, ...PROPOSAL_TOOL_NAMES, HAND_OFF_TOOL_NAME]);
    expect(dashToolsOf('lookup').map((t) => t.name)).toEqual([...ASK_TOOL_NAMES]);
    expect(dashToolsOf('proposal').map((t) => t.name)).toEqual([...PROPOSAL_TOOL_NAMES]);
    expect(dashToolsOf('handoff').map((t) => t.name)).toEqual([HAND_OFF_TOOL_NAME]);
    expect(dashToolsOf('write')).toEqual([]);
  });

  it('names each tool once, by the name its definition sends', () => {
    const names = DASH_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const tool of DASH_TOOLS) expect(tool.definition.name).toBe(tool.name);
    expect(names).not.toContain('answer');
  });

  it('carries the lookup definitions unchanged and marks the in-app ones', () => {
    for (const lookup of dashToolsOf('lookup')) {
      expect(lookup.definition).toBe(ASK_TOOLS.find((t) => t.name === lookup.name));
      expect(lookup.inAppOnly ?? false).toBe((IN_APP_ONLY_TOOLS as readonly string[]).includes(lookup.name));
    }
  });

  it('finds a tool by name, and nothing for a made-up one', () => {
    expect(dashTool('todos')?.kind).toBe('lookup');
    expect(dashTool('propose_todo')?.kind).toBe('proposal');
    expect(dashTool('hand_off')?.kind).toBe('handoff');
    expect(dashTool('propose_nothing')).toBeUndefined();
  });
});
