import { describe, expect, it, vi } from 'vitest';
import { ASK_ACTION_RULES } from '@/lib/dash/ask';
import { dashTool, type DashPaidTool, type DashWriteTool } from '@/lib/dash/registry';
import type { DashChange } from '@/lib/talk/changes';
import { PEOPLE_ACTION_RULES, PEOPLE_TOOLS, peopleActing, type PeopleDash } from './people-actions';

const CAUSE = { advisorId: 'adv-1', chatId: 'chat-1', messageId: 'msg-1' };
const seen = () => true;

function kept(id: string, kind: string): DashChange {
  return { id, kind, input: {}, conversationId: '', turnId: null, status: 'done' } as unknown as DashChange;
}

function stubDash(overrides: Partial<PeopleDash> = {}): PeopleDash {
  return {
    apply: vi.fn(async () => ({
      ok: true as const,
      kind: 'add_todo',
      input: { title: 'Call the bank' },
      subjectRef: 'todo.tasks:t1',
      op: 'insert' as const,
      before: null,
      after: { id: 't1' },
      summary: 'Added the todo "Call the bank".',
      row: { table: 'todo.tasks', ref: 't1', title: 'Call the bank' },
    })) as unknown as PeopleDash['apply'],
    saveChange: vi.fn(async () => kept('a1', 'add_todo')),
    propose: vi.fn(async (_name, _args, _seen, save) => {
      const proposal = await save({ kind: 'start_build', input: { stepId: 7 } } as never);
      return { ok: true as const, rows: [], note: `Proposed ${proposal.id}` };
    }),
    queue: vi.fn(async () => ({ ok: true as const, change: { kind: 'paid_action', input: {} } as never, note: 'Queued.' })),
    saveProposal: vi.fn(async (change) => kept('p1', change.kind)),
    ...overrides,
  };
}

describe('the tools people on People act with', () => {
  it("are Ask Dash's writes, proposals and paid presses, without the hand-off or the chart", () => {
    const names = PEOPLE_TOOLS.map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining(['add_todo', 'add_goal', 'add_goal_step', 'add_idea', 'add_role_note', 'add_plan_step']));
    expect(names).toEqual(expect.arrayContaining(['propose_build', 'propose_delete', 'propose_watch']));
    expect(PEOPLE_TOOLS.some((tool) => tool.kind === 'paid')).toBe(true);
    expect(names).not.toContain('hand_off');
    expect(names).not.toContain('show_chart');
    // No row thread's own tool: People has no row.
    expect(PEOPLE_TOOLS.every((tool) => !('subjects' in tool) || !tool.subjects)).toBe(true);
  });

  it("carry Ask's own rules for changes, word for word, after the lean", () => {
    expect(ASK_ACTION_RULES.startsWith('YOU MAKE THE CHANGES THEY ASK FOR')).toBe(true);
    expect(ASK_ACTION_RULES).toContain('A BUILD IS PROPOSED, NOT STARTED.');
    expect(ASK_ACTION_RULES).toContain('A DELETE IS PROPOSED, NOT DONE.');
    expect(ASK_ACTION_RULES).not.toContain('ANYTHING ELSE THEY ASK YOU TO DO');
    expect(PEOPLE_ACTION_RULES.endsWith(ASK_ACTION_RULES)).toBe(true);
    expect(PEOPLE_ACTION_RULES).toContain('never a reason to refuse');
  });
});

describe('peopleActing', () => {
  it('makes a write and keeps it naming the person and the text it answered', async () => {
    const dash = stubDash();
    const acting = peopleActing(dash, CAUSE);
    const tool = dashTool('add_todo') as DashWriteTool;
    const result = await acting.write(tool, { title: 'Call the bank' }, seen as never);
    expect(result.ok).toBe(true);
    expect(dash.saveChange).toHaveBeenCalledWith(expect.objectContaining({ kind: 'add_todo', subjectRef: 'todo.tasks:t1' }), CAUSE);
    expect(acting.changes.map((c) => c.id)).toEqual(['a1']);
    if (result.ok) expect(result.note).toContain('Undo');
  });

  it('says a write stands when its record could not be kept', async () => {
    const dash = stubDash({ saveChange: vi.fn(async () => Promise.reject(new Error('down'))) });
    const result = await peopleActing(dash, CAUSE).write(dashTool('add_todo') as DashWriteTool, {}, seen as never);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.note).toContain('could not be kept');
  });

  it('passes a refusal back to the model and keeps nothing', async () => {
    const dash = stubDash({ apply: vi.fn(async () => ({ ok: false as const, error: 'No such goal.' })) as never });
    const acting = peopleActing(dash, CAUSE);
    expect(await acting.write(dashTool('add_goal_step') as DashWriteTool, {}, seen as never)).toEqual({ ok: false, error: 'No such goal.' });
    expect(dash.saveChange).not.toHaveBeenCalled();
    expect(acting.changes).toEqual([]);
  });

  it('keeps a build as a proposal under the text, and writes nothing else', async () => {
    const dash = stubDash();
    const acting = peopleActing(dash, CAUSE);
    const result = await acting.propose('propose_build', { step: '2854.2' }, seen as never);
    expect(result.ok).toBe(true);
    expect(dash.saveProposal).toHaveBeenCalledWith(expect.objectContaining({ kind: 'start_build' }), CAUSE);
    expect(dash.apply).not.toHaveBeenCalled();
    expect(acting.changes.map((c) => c.id)).toEqual(['p1']);
  });

  it('queues a paid press as a proposal and runs nothing', async () => {
    const dash = stubDash();
    const acting = peopleActing(dash, CAUSE);
    const paid = PEOPLE_TOOLS.find((tool) => tool.kind === 'paid') as DashPaidTool;
    const result = await acting.queue(paid, {}, seen as never);
    expect(result.ok).toBe(true);
    expect(dash.saveProposal).toHaveBeenCalledWith(expect.objectContaining({ kind: 'paid_action' }), CAUSE);
  });

  it('never throws when a binding breaks', async () => {
    const dash = stubDash({
      apply: vi.fn(async () => Promise.reject(new Error('boom'))) as never,
      propose: vi.fn(async () => Promise.reject(new Error('boom'))),
    });
    const acting = peopleActing(dash, CAUSE);
    expect((await acting.write(dashTool('add_todo') as DashWriteTool, {}, seen as never)).ok).toBe(false);
    expect((await acting.propose('propose_delete', {}, seen as never)).ok).toBe(false);
  });
});
