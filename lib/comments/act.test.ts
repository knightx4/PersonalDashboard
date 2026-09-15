import { describe, expect, it, vi } from 'vitest';
import { carryOut, type ActInput } from './act';
import { handStepToClaude } from '@/lib/plan/handover';
import type { DashAction } from './reply-payload';

// The hand-over is its own tested unit and reads the whole plan tree; what
// matters here is which step id reaches it.
vi.mock('@/lib/plan/handover', () => ({
  handStepToClaude: vi.fn(async () => ({
    ok: true,
    number: 342,
    title: 'Refuse a second session on a step',
    beneath: 0,
    detail: 'The routine is running.',
    changed: true,
  })),
}));

type Write = { table: string; op: 'insert' | 'update'; row: Record<string, unknown> };

/**
 * A client that records what it was asked to write, hands back one row when
 * something reads, and can be made to fail. Enough for the two things an
 * action does: read what is there and write what was asked for.
 */
function db(options: { row?: Record<string, unknown> | null; error?: { message: string } } = {}) {
  const writes: Write[] = [];
  const error = options.error ?? null;
  const supabase = {
    from(table: string) {
      return {
        insert(row: Record<string, unknown>) {
          writes.push({ table, op: 'insert', row });
          return Promise.resolve({ error });
        },
        select() {
          // `eq` chains, because a lookup by number filters on the account as
          // well: eq('user_id').eq('number').maybeSingle().
          const filtered = {
            eq: () => filtered,
            maybeSingle: () => Promise.resolve({ data: options.row ?? null }),
          };
          return filtered;
        },
        update(row: Record<string, unknown>) {
          writes.push({ table, op: 'update', row });
          return { eq: () => Promise.resolve({ error }) };
        },
      };
    },
  };
  return { writes, supabase: supabase as unknown as ActInput['supabase'] };
}

function action(over: Partial<DashAction> & { name: string }): DashAction {
  return { text: null, module: null, field: null, ...over };
}

function input(over: Partial<ActInput> & { action: DashAction }): ActInput {
  return { supabase: db().supabase, userId: 'user-1', target: 'step', id: 'row-1', ...over };
}

describe('filing an idea from a comment', () => {
  it('files it as a suggestion, under the step it came from', async () => {
    const { writes, supabase } = db();
    const outcome = await carryOut(
      input({
        supabase,
        action: action({
          name: 'file_idea',
          text: 'Let a note be filed from a keyboard shortcut.',
          module: 'vault',
        }),
      }),
    );

    expect(outcome.ok).toBe(true);
    expect(writes).toHaveLength(1);
    expect(writes[0].table).toBe('ideas');
    expect(writes[0].row).toMatchObject({
      user_id: 'user-1',
      body: 'Let a note be filed from a keyboard shortcut.',
      module: 'vault',
      source: 'claude',
      from_plan_item_id: 'row-1',
    });
    expect(outcome.ok && outcome.said).toContain('Let a note be filed from a keyboard shortcut.');
    expect(outcome.ok && outcome.said).toContain('Vault');
    expect(outcome.ok && outcome.redraw).toBe('/dev/ideas');
  });

  it('points it at no step when the comment was not on one', async () => {
    const { writes, supabase } = db();
    await carryOut(
      input({ supabase, target: 'idea', action: action({ name: 'file_idea', text: 'Two ideas can merge.' }) }),
    );
    expect(writes[0].row.from_plan_item_id).toBeNull();
  });

  it('reads a workspace nothing can look up as the app as a whole', async () => {
    const { writes, supabase } = db();
    const outcome = await carryOut(
      input({ supabase, action: action({ name: 'file_idea', text: 'A search box everywhere.', module: 'nope' }) }),
    );
    expect(writes[0].row.module).toBeNull();
    expect(outcome.ok && outcome.said).toContain('the app as a whole');
  });

  it('writes nothing when it cannot tell what to file', async () => {
    const { writes, supabase } = db();
    const outcome = await carryOut(input({ supabase, action: action({ name: 'file_idea' }) }));
    expect(writes).toHaveLength(0);
    expect(outcome.ok === false && outcome.why).toContain('nothing was written down');
  });

  it('says so when the write itself fails', async () => {
    const { supabase } = db({ error: { message: 'new row violates row-level security policy' } });
    const outcome = await carryOut(input({ supabase, action: action({ name: 'file_idea', text: 'Anything.' }) }));
    expect(outcome.ok === false && outcome.why).toContain('row-level security');
  });
});

describe('rewording the row a comment is on', () => {
  it('rewrites an idea and carries the old text back', async () => {
    const { writes, supabase } = db({ row: { body: 'Receipts by photo.' } });
    const outcome = await carryOut(
      input({
        supabase,
        target: 'idea',
        action: action({ name: 'reword', text: 'Take a photo of a receipt and file it against the order.' }),
      }),
    );

    expect(writes).toEqual([
      {
        table: 'ideas',
        op: 'update',
        row: { body: 'Take a photo of a receipt and file it against the order.' },
      },
    ]);
    expect(outcome.ok && outcome.said).toContain('Take a photo of a receipt');
    expect(outcome.ok && outcome.said).toContain('Receipts by photo.');
  });

  it('rewrites a step title, its detail and its done-when', async () => {
    for (const [named, column] of [
      ['title', 'title'],
      ['detail', 'detail'],
      ['done_when', 'acceptance'],
      ['the done when', 'acceptance'],
      ['acceptance', 'acceptance'],
    ]) {
      const { writes, supabase } = db({ row: { [column]: 'What it said before.' } });
      const outcome = await carryOut(
        input({ supabase, action: action({ name: 'reword', field: named, text: 'What it says now.' }) }),
      );
      expect(writes).toEqual([
        { table: 'plan_items', op: 'update', row: { [column]: 'What it says now.' } },
      ]);
      expect(outcome.ok && outcome.said).toContain('What it said before.');
    }
  });

  it('refuses every part of a step that is the person\'s own move', async () => {
    for (const field of ['status', 'assignee', 'approved', 'resolution', 'priority']) {
      const { writes, supabase } = db({ row: { title: 'A step' } });
      const outcome = await carryOut(
        input({ supabase, action: action({ name: 'reword', field, text: 'done' }) }),
      );
      expect(writes).toHaveLength(0);
      expect(outcome.ok).toBe(false);
      expect(outcome.ok === false && outcome.why).toContain('yours on the page');
    }
  });

  it('changes nothing when the row has gone', async () => {
    const { writes, supabase } = db({ row: null });
    const outcome = await carryOut(
      input({ supabase, action: action({ name: 'reword', field: 'title', text: 'Anything' }) }),
    );
    expect(writes).toHaveLength(0);
    expect(outcome.ok === false && outcome.why).toContain('not there any more');
  });

  it('refuses a title longer than the column holds', async () => {
    const { writes, supabase } = db({ row: { title: 'A step' } });
    const outcome = await carryOut(
      input({ supabase, action: action({ name: 'reword', field: 'title', text: 'x'.repeat(201) }) }),
    );
    expect(writes).toHaveLength(0);
    expect(outcome.ok === false && outcome.why).toContain('200 characters');
  });

  it('will not reword a raise or a bug note', async () => {
    for (const [target, said] of [
      ['raise', 'a raise'],
      ['note', 'a bug note'],
    ] as const) {
      const { writes, supabase } = db({ row: { title: 'A row' } });
      const outcome = await carryOut(
        input({ supabase, target, action: action({ name: 'reword', text: 'Something else' }) }),
      );
      expect(writes).toHaveLength(0);
      expect(outcome.ok === false && outcome.why).toContain(said);
    }
  });
});

describe('sending a step to be built', () => {
  it('will not start anything from a row that is not a step and names none', async () => {
    for (const target of ['idea', 'raise', 'note'] as const) {
      const { writes, supabase } = db();
      const outcome = await carryOut(input({ supabase, target, action: action({ name: 'send_step' }) }));
      expect(writes).toHaveLength(0);
      expect(outcome.ok === false && outcome.why).toContain('nothing was started');
    }
  });

  // A raise has no step of its own, so its consequence names one by number --
  // "yes, build #342". The number is looked up under the caller's own id.
  it('sends the step a raise named by number', async () => {
    const { supabase } = db({ row: { id: 'step-342' } });
    const outcome = await carryOut(
      input({ supabase, target: 'raise', id: 'raise-1', action: action({ name: 'send_step', text: '#342' }) }),
    );

    expect(outcome.ok).toBe(true);
    expect(vi.mocked(handStepToClaude)).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', id: 'step-342' }),
    );
  });

  it('says so when the number a raise named is not a step of yours', async () => {
    const { supabase } = db({ row: null });
    const outcome = await carryOut(
      input({ supabase, target: 'raise', id: 'raise-1', action: action({ name: 'send_step', text: '#9999' }) }),
    );

    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.why).toContain('nothing was started');
  });
});

describe('an instruction outside the list', () => {
  it('changes nothing and says whose move it is', async () => {
    for (const name of [
      'approve_step',
      'answer_decision',
      'dismiss',
      'delete_row',
      'set_status',
      'assign_step',
      'close_note',
    ]) {
      const { writes, supabase } = db();
      const outcome = await carryOut(input({ supabase, action: action({ name }) }));
      expect(writes).toHaveLength(0);
      expect(outcome.ok).toBe(false);
      expect(outcome.ok === false && outcome.why).toContain(name);
      expect(outcome.ok === false && outcome.why).toContain('yours to make on the page');
      // Theirs is an answer, not a dead end: nothing is handed on.
      expect(outcome.ok === false && outcome.route).toBeUndefined();
    }
  });

  // The other half of outside-the-list, and the one note 5785ad63 was about:
  // asked to update the plan it said it could not, when the thing it could not
  // do is only this call, with one message and no repository.
  it('hands on anything that is neither its own nor the person\'s', async () => {
    for (const name of ['update_plan', 'add_step', 'split_feature', 'write_note', 'fix_bug']) {
      const { writes, supabase } = db();
      const outcome = await carryOut(input({ supabase, action: action({ name }) }));
      expect(writes).toHaveLength(0);
      expect(outcome.ok).toBe(false);
      expect(outcome.ok === false && outcome.route).toBe(true);
      expect(outcome.ok === false && outcome.why).toContain(name);
    }
  });
});
