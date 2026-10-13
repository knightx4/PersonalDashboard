import { describe, expect, it } from 'vitest';
import { summariseAgentActions } from './summary';
import type { CataloguedAction } from './catalogue';
import type { DashTool } from '@/lib/dash/registry';

const lookup = { name: 'todos', kind: 'lookup', definition: { name: 'todos', input_schema: { type: 'object' } } };
const write = { name: 'add_todo', kind: 'write', definition: { name: 'add_todo', input_schema: { type: 'object' } } };
const capture = {
  name: 'file_close',
  kind: 'write',
  subjects: ['goals.captures'],
  definition: { name: 'file_close', input_schema: { type: 'object' } },
};
const TOOLS = [lookup, write, capture] as unknown as DashTool[];

const ACTIONS: CataloguedAction[] = [
  { file: 'app/todo/actions.ts', name: 'addTask', workspace: 'todo', entry: { tool: 'add_todo' } },
  { file: 'app/todo/actions.ts', name: 'removeTask', workspace: 'todo', entry: { none: 'deletes' } },
  { file: 'app/todo/actions.ts', name: 'pinTask', workspace: 'todo', entry: { gap: true } },
  { file: 'app/goals/capture-actions.ts', name: 'fileGoalCapture', workspace: 'goals', entry: { tool: ['file_close'] } },
  { file: 'app/(auth)/actions.ts', name: 'signIn', workspace: null, entry: { none: 'account' } },
  { file: 'app/thread-actions.ts', name: 'deleteRowComment', workspace: null, entry: { none: 'deletes' } },
];

describe('summariseAgentActions', () => {
  const summary = summariseAgentActions(ACTIONS, TOOLS);

  it('counts each kind', () => {
    expect([summary.total, summary.tool, summary.none, summary.gap]).toEqual([6, 2, 3, 1]);
  });

  it('orders the reasons by use', () => {
    expect(summary.reasons.map((r) => [r.reason, r.count])).toEqual([
      ['deletes', 2],
      ['account', 1],
    ]);
  });

  it('groups by workspace and names the one with none', () => {
    expect(summary.groups.map((g) => [g.label, g.tool, g.none, g.gap])).toEqual([
      ['Todo', 1, 1, 1],
      ['Goals', 1, 0, 0],
      ['Across the app', 0, 2, 0],
    ]);
  });

  it('says where each tool is offered', () => {
    const rows = summary.groups.flatMap((g) => g.rows);
    expect(rows.find((r) => r.name === 'addTask')?.tools).toEqual([{ name: 'add_todo', where: 'ask' }]);
    expect(rows.find((r) => r.name === 'fileGoalCapture')?.tools).toEqual([
      { name: 'file_close', where: 'capture' },
    ]);
  });
});
