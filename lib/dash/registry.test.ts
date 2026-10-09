import { describe, expect, it } from 'vitest';
import { ASK_TOOLS, ASK_TOOL_NAMES, IN_APP_ONLY_TOOLS } from '@/lib/ask/tools';
import { HAND_OFF_TOOL_NAME } from '@/lib/talk/handoff';
import { WRITE_TOOL_KINDS } from '@/lib/core/dash-actions';
import { ASK_DASH_TOOLS, DASH_TOOLS, captureDashTools, dashTool, dashToolsOf, threadDashTools } from './registry';
import { CAPTURE_TOOL_NAMES } from './capture-tools';
import { DEV_THREAD_TABLES, GOAL_THREAD_TABLE, ROLE_THREAD_TABLE, THREAD_TOOL_NAMES } from './thread-tools';
import { WRITE_TOOL_NAMES } from './writes';
import { isShownLookup, WRITE_TOOL_NAMES_SHOWN_AS_CARDS } from '@/lib/talk/lookups';

/** Dash's one tool registry (plan #1463): every tool Ask had, each declared once. */
describe('DASH_TOOLS', () => {
  it('lists every lookup, the writes, the thread tools, the capture moves, the watch proposal and the hand-off, in the order sent', () => {
    expect(DASH_TOOLS.map((t) => t.name)).toEqual([
      ...ASK_TOOL_NAMES,
      ...WRITE_TOOL_NAMES,
      ...THREAD_TOOL_NAMES,
      ...CAPTURE_TOOL_NAMES,
      'propose_watch',
      HAND_OFF_TOOL_NAME,
    ]);
    expect(dashToolsOf('lookup').map((t) => t.name)).toEqual([...ASK_TOOL_NAMES]);
    // The other three proposals became writes (plan #1440); a watch acts outside the app.
    expect(dashToolsOf('proposal').map((t) => t.name)).toEqual(['propose_watch']);
    expect(dashToolsOf('handoff').map((t) => t.name)).toEqual([
      'send_step',
      'pass_to_session',
      'take_step',
      'pass_to_routine',
      HAND_OFF_TOOL_NAME,
    ]);
    expect(WRITE_TOOL_NAMES).toEqual([
      'add_todo',
      'change_todo',
      'close_todo',
      'add_goal',
      'add_goal_step',
      'close_goal_step',
      'set_goal_done_when',
      'mark_returned',
      'add_role_note',
      'add_job_lead',
      'add_idea',
      'change_items',
      'move_roles',
    ]);
    expect(dashToolsOf('write').map((t) => t.name)).toEqual([
      ...WRITE_TOOL_NAMES,
      'file_idea',
      'file_note',
      'add_step',
      'reword',
      'build_step',
      'file_goal_record',
      'schedule_goal_step',
      'write_cover_letter',
      'file_close',
      'file_count',
      'file_progress',
      'file_reading',
      'file_add',
    ]);
    // Ask's undo puts back exactly the kinds the write tools record.
    expect([...WRITE_TOOL_KINDS]).toEqual(WRITE_TOOL_NAMES);
  });

  it('keeps a thread\'s own tools out of Ask', () => {
    expect(ASK_DASH_TOOLS.map((t) => t.name)).toEqual([
      ...ASK_TOOL_NAMES,
      ...WRITE_TOOL_NAMES,
      'propose_watch',
      HAND_OFF_TOOL_NAME,
    ]);
  });

  it('offers each thread the lookups, the writes and its own row\'s tools, without the watch or the hand-off', () => {
    const own = (table: string) =>
      threadDashTools(table)
        .map((t) => t.name)
        .filter((name) => !ASK_TOOL_NAMES.includes(name as never) && !WRITE_TOOL_NAMES.includes(name));
    for (const table of [...Object.values(DEV_THREAD_TABLES), GOAL_THREAD_TABLE, ROLE_THREAD_TABLE]) {
      const names = threadDashTools(table).map((t) => t.name);
      expect(names.slice(0, ASK_TOOL_NAMES.length + WRITE_TOOL_NAMES.length)).toEqual([...ASK_TOOL_NAMES, ...WRITE_TOOL_NAMES]);
      expect(names).not.toContain('propose_watch');
      expect(names).not.toContain(HAND_OFF_TOOL_NAME);
    }
    expect(own(DEV_THREAD_TABLES.step)).toEqual(['file_idea', 'file_note', 'add_step', 'reword', 'build_step', 'send_step', 'pass_to_session']);
    expect(own(DEV_THREAD_TABLES.raise)).toEqual(['file_idea', 'file_note', 'add_step', 'build_step', 'send_step', 'pass_to_session']);
    expect(own(DEV_THREAD_TABLES.change)).toEqual(['file_idea', 'file_note', 'reword', 'pass_to_session']);
    expect(own(GOAL_THREAD_TABLE)).toEqual(['file_goal_record', 'schedule_goal_step', 'take_step', 'pass_to_routine']);
    expect(own(ROLE_THREAD_TABLE)).toEqual(['write_cover_letter']);
  });

  it('offers the capture box its five moves and nothing else, and no other surface those moves', () => {
    expect(captureDashTools().map((t) => t.name)).toEqual([
      'file_close',
      'file_count',
      'file_progress',
      'file_reading',
      'file_add',
    ]);
    for (const table of [...Object.values(DEV_THREAD_TABLES), GOAL_THREAD_TABLE, ROLE_THREAD_TABLE]) {
      for (const name of CAPTURE_TOOL_NAMES) expect(threadDashTools(table).map((t) => t.name)).not.toContain(name);
    }
    for (const name of CAPTURE_TOOL_NAMES) expect(ASK_DASH_TOOLS.map((t) => t.name)).not.toContain(name);
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
