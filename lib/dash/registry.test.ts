import { describe, expect, it } from 'vitest';
import { ASK_TOOLS, ASK_TOOL_NAMES, IN_APP_ONLY_TOOLS } from '@/lib/ask/tools';
import { HAND_OFF_TOOL_NAME } from '@/lib/talk/handoff';
import { DASH_TOOLS, dashTool, dashToolsOf } from './registry';
import { WRITE_TOOL_NAMES } from './writes';
import { isShownLookup, WRITE_TOOL_NAMES_SHOWN_AS_CARDS } from '@/lib/talk/lookups';

/** Dash's one tool registry (plan #1463): every tool Ask had, each declared once. */
describe('DASH_TOOLS', () => {
  it('lists every lookup, the writes, the watch proposal and the hand-off, in the order sent', () => {
    expect(DASH_TOOLS.map((t) => t.name)).toEqual([
      ...ASK_TOOL_NAMES,
      ...WRITE_TOOL_NAMES,
      'propose_watch',
      HAND_OFF_TOOL_NAME,
    ]);
    expect(dashToolsOf('lookup').map((t) => t.name)).toEqual([...ASK_TOOL_NAMES]);
    // The other three proposals became writes (plan #1440); a watch acts outside the app.
    expect(dashToolsOf('proposal').map((t) => t.name)).toEqual(['propose_watch']);
    expect(dashToolsOf('handoff').map((t) => t.name)).toEqual([HAND_OFF_TOOL_NAME]);
    expect(WRITE_TOOL_NAMES).toEqual([
      'add_todo',
      'change_todo',
      'close_todo',
      'add_goal',
      'add_goal_step',
      'close_goal_step',
      'mark_returned',
      'add_role_note',
    ]);
    expect(dashToolsOf('write').map((t) => t.name)).toEqual(WRITE_TOOL_NAMES);
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
    expect(dashTool('propose_watch')?.kind).toBe('proposal');
    expect(dashTool('close_todo')?.kind).toBe('write');
    expect(dashTool('propose_todo')).toBeUndefined();
    expect(dashTool('hand_off')?.kind).toBe('handoff');
    expect(dashTool('propose_nothing')).toBeUndefined();
  });

  it('keeps writes out of the lookup lines, since each has a card under the answer', () => {
    expect([...WRITE_TOOL_NAMES_SHOWN_AS_CARDS]).toEqual(WRITE_TOOL_NAMES);
    for (const name of WRITE_TOOL_NAMES) expect(isShownLookup(name)).toBe(false);
    expect(isShownLookup('todos')).toBe(true);
  });
});
