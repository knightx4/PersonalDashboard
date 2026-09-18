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
function db(
  options: {
    row?: Record<string, unknown> | null;
    /** What a list read hands back -- the sibling a new step is positioned after. */
    rows?: Record<string, unknown>[];
    /** What an insert asked for its row back hands back: `build_step` needs the number. */
    inserted?: Record<string, unknown> | null;
    error?: { message: string };
  } = {},
) {
  const writes: Write[] = [];
  const error = options.error ?? null;
  const supabase = {
    from(table: string) {
      return {
        insert(row: Record<string, unknown>) {
          writes.push({ table, op: 'insert', row });
          // A thenable that also chains, the shape the real builder has: an
          // insert is awaited on its own, or has `.select().maybeSingle()`
          // hung off it when the caller needs the row it just wrote.
          return Object.assign(Promise.resolve({ error }), {
            select: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: error ? null : (options.inserted ?? { id: 'new-step', number: 712 }),
                  error,
                }),
            }),
          });
        },
        select() {
          // `eq` chains, because a lookup by number filters on the account as
          // well: eq('user_id').eq('number').maybeSingle(). `is` and `order`
          // chain for the same reason: finding the end of a sibling list ends
          // in `limit`, and everything before it narrows.
          const filtered = {
            eq: () => filtered,
            is: () => filtered,
            order: () => filtered,
            limit: () => Promise.resolve({ data: options.rows ?? [] }),
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
  return {
    name: over.name,
    text: over.text ?? null,
    module: over.module ?? null,
    field: over.field ?? null,
    detail: over.detail ?? null,
    kind: over.kind ?? null,
  };
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

  it('rewrites a bug note and carries the old report back', async () => {
    const { writes, supabase } = db({ row: { body: 'The picker is broken.' } });
    const outcome = await carryOut(
      input({
        supabase,
        target: 'note',
        action: action({ name: 'reword', text: 'The shelf photo picker opens on the wrong shelf.' }),
      }),
    );

    expect(writes).toEqual([
      {
        table: 'feedback_items',
        op: 'update',
        row: { body: 'The shelf photo picker opens on the wrong shelf.' },
      },
    ]);
    expect(outcome.ok && outcome.said).toContain('The picker is broken.');
  });

  // The status, the priority and the resolution are the queue's record of the
  // work, not the report of the problem.
  it('touches nothing on a note but its body', async () => {
    const { writes, supabase } = db({ row: { body: 'Was' } });
    await carryOut(input({ supabase, target: 'note', action: action({ name: 'reword', text: 'Now' }) }));
    expect(Object.keys(writes[0].row)).toEqual(['body']);
  });

  // A raise has no wording of its own, and "put this in the plan" is what
  // arrives as a reword on one. Refusing it was a dead end over a name (#604).
  it('puts a reword aimed at a raise on the plan instead of refusing it', async () => {
    const { writes, supabase } = db({ rows: [{ position: 20 }] });
    const outcome = await carryOut(
      input({
        supabase,
        target: 'raise',
        id: 'raise-1',
        action: action({ name: 'reword', text: 'Say which actions apply on which row', module: 'dev' }),
      }),
    );

    expect(outcome.ok).toBe(true);
    expect(writes).toEqual([
      {
        table: 'plan_items',
        op: 'insert',
        row: {
          user_id: 'user-1',
          module: 'dev',
          parent_id: null,
          title: 'Say which actions apply on which row',
          detail: null,
          status: 'proposed',
          kind: 'build',
          position: 30,
        },
      },
    ]);
    expect(outcome.ok && outcome.said).toContain('no wording of its own');
    expect(outcome.ok && outcome.said).toContain('Say which actions apply on which row');
    expect(outcome.ok && outcome.redraw).toBe('/dev/plan');
  });

  it('writes nothing from a reword on a raise it cannot name', async () => {
    const { writes, supabase } = db();
    const outcome = await carryOut(
      input({ supabase, target: 'raise', id: 'raise-1', action: action({ name: 'reword' }) }),
    );
    expect(writes).toHaveLength(0);
    expect(outcome.ok).toBe(false);
  });
});

describe('filing a note from a comment', () => {
  it('files a bug on the queue, open, with the page it came from', async () => {
    const { writes, supabase } = db();
    const outcome = await carryOut(
      input({
        supabase,
        action: action({ name: 'file_note', kind: 'bug', text: 'The shelf picker opens on the wrong shelf.' }),
      }),
    );

    expect(outcome.ok).toBe(true);
    expect(writes).toEqual([
      {
        table: 'feedback_items',
        op: 'insert',
        row: {
          user_id: 'user-1',
          kind: 'bug',
          body: 'The shelf picker opens on the wrong shelf.',
          page_path: '/dev/plan',
        },
      },
    ]);
    expect(outcome.ok && outcome.redraw).toBe('/dev/bugs');
  });

  it('files a feature request when it was told it was one', async () => {
    const { writes, supabase } = db();
    const outcome = await carryOut(
      input({ supabase, target: 'idea', action: action({ name: 'file_note', kind: 'feature', text: 'A keyboard shortcut.' }) }),
    );
    expect(writes[0].row).toMatchObject({ kind: 'feature', page_path: '/dev/ideas' });
    expect(outcome.ok && outcome.said).toContain('a feature request');
  });

  // Both are one queue and the kind is a dropdown away from right; a note
  // refused over its heading is a note that does not exist.
  it('files anything it was not told the kind of as a bug', async () => {
    for (const kind of [null, 'defect', 'PROBLEM']) {
      const { writes, supabase } = db();
      await carryOut(input({ supabase, action: action({ name: 'file_note', kind, text: 'Something is wrong.' }) }));
      expect(writes[0].row.kind).toBe('bug');
    }
  });

  // Nothing here ranks a note or closes one: the queue is worked in order and
  // a priority read out of a sentence would outrank the ones they set.
  it('sets no priority, no status and no resolution', async () => {
    const { writes, supabase } = db();
    await carryOut(input({ supabase, action: action({ name: 'file_note', text: 'Something.' }) }));
    expect(Object.keys(writes[0].row).sort()).toEqual(['body', 'kind', 'page_path', 'user_id']);
  });

  it('writes nothing when it cannot tell what to write up', async () => {
    const { writes, supabase } = db();
    const outcome = await carryOut(input({ supabase, action: action({ name: 'file_note' }) }));
    expect(writes).toHaveLength(0);
    expect(outcome.ok === false && outcome.why).toContain('no note was filed');
  });

  it('says so when the write itself fails', async () => {
    const { supabase } = db({ error: { message: 'new row violates row-level security policy' } });
    const outcome = await carryOut(input({ supabase, action: action({ name: 'file_note', text: 'Anything.' }) }));
    expect(outcome.ok === false && outcome.why).toContain('row-level security');
  });
});

describe('adding a step from a comment', () => {
  it('adds it under the step the comment is on, in that step\'s workspace', async () => {
    const { writes, supabase } = db({ row: { module: 'shopping' }, rows: [{ position: 40 }] });
    const outcome = await carryOut(
      input({
        supabase,
        action: action({ name: 'add_step', text: 'Crop the photo', detail: 'Square, and centred on the shelf.' }),
      }),
    );

    expect(outcome.ok).toBe(true);
    expect(writes).toEqual([
      {
        table: 'plan_items',
        op: 'insert',
        row: {
          user_id: 'user-1',
          module: 'shopping',
          parent_id: 'row-1',
          title: 'Crop the photo',
          detail: 'Square, and centred on the shelf.',
          status: 'proposed',
          kind: 'build',
          position: 50,
        },
      },
    ]);
    expect(outcome.ok && outcome.said).toContain('under this one');
    expect(outcome.ok && outcome.redraw).toBe('/dev/plan');
  });

  // The whole of why this is safe to do on an instruction: a proposal is not
  // work, and approving it stays theirs.
  it('adds it as a proposal, with nobody on it', async () => {
    const { writes, supabase } = db({ row: { module: null } });
    await carryOut(input({ supabase, action: action({ name: 'add_step', text: 'A step' }) }));
    expect(writes[0].row.status).toBe('proposed');
    expect(writes[0].row).not.toHaveProperty('assignee');
    expect(writes[0].row).not.toHaveProperty('priority');
  });

  it('adds a feature at the top of a workspace when the comment is not on a step', async () => {
    const { writes, supabase } = db();
    const outcome = await carryOut(
      input({
        supabase,
        target: 'idea',
        action: action({ name: 'add_step', text: 'Shelf photos', module: 'vault' }),
      }),
    );
    expect(writes[0].row).toMatchObject({ parent_id: null, module: 'vault', position: 10 });
    expect(outcome.ok && outcome.said).toContain('Vault');
  });

  // The done-when this file is checked against: a comment on a raise asking for
  // the plan to be updated leaves a proposal on the plan page, and the line
  // written back names it.
  it('adds a proposal at the top of a workspace from a comment on a raise', async () => {
    const { writes, supabase } = db({ rows: [{ position: 60 }] });
    const outcome = await carryOut(
      input({
        supabase,
        target: 'raise',
        id: 'raise-1',
        action: action({
          name: 'add_step',
          text: 'Name the actions a raise takes',
          detail: 'The prompt says which of the five apply on which kind of row.',
          module: 'dev',
        }),
      }),
    );

    expect(outcome.ok).toBe(true);
    expect(writes[0].row).toMatchObject({
      parent_id: null,
      module: 'dev',
      status: 'proposed',
      title: 'Name the actions a raise takes',
      position: 70,
    });
    expect(outcome.ok && outcome.said).toContain('Name the actions a raise takes');
    expect(outcome.ok && outcome.said).toContain('Dev');
    expect(outcome.ok && outcome.redraw).toBe('/dev/plan');
  });

  it('adds nothing when it cannot tell what to call it', async () => {
    const { writes, supabase } = db({ row: { module: null } });
    const outcome = await carryOut(input({ supabase, action: action({ name: 'add_step' }) }));
    expect(writes).toHaveLength(0);
    expect(outcome.ok === false && outcome.why).toContain('no step was added');
  });

  it('refuses a name longer than the column holds', async () => {
    const { writes, supabase } = db({ row: { module: null } });
    const outcome = await carryOut(
      input({ supabase, action: action({ name: 'add_step', text: 'x'.repeat(201) }) }),
    );
    expect(writes).toHaveLength(0);
    expect(outcome.ok === false && outcome.why).toContain('200 characters');
  });

  it('adds nothing when the step it would hang under has gone', async () => {
    const { writes, supabase } = db({ row: null });
    const outcome = await carryOut(
      input({ supabase, action: action({ name: 'add_step', text: 'A step' }) }),
    );
    expect(writes).toHaveLength(0);
    expect(outcome.ok === false && outcome.why).toContain('not there any more');
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

describe('writing a step from a raise and sending it', () => {
  // The done-when: a comment on a raise telling Dash to do the work leaves a
  // step on the plan, ready to be worked rather than proposed (#605), and a
  // session on it. The line written back names it by number.
  it('writes the step ready to be worked and hands it straight over', async () => {
    const { writes, supabase } = db({ rows: [{ position: 40 }] });
    const outcome = await carryOut(
      input({
        supabase,
        target: 'raise',
        id: 'raise-1',
        action: action({
          name: 'build_step',
          text: 'Say which run is holding a step',
          detail: 'The refusal names how long the other session has been silent.',
          module: 'dev',
        }),
      }),
    );

    expect(writes).toHaveLength(1);
    expect(writes[0].table).toBe('plan_items');
    expect(writes[0].row).toMatchObject({
      user_id: 'user-1',
      parent_id: null,
      module: 'dev',
      title: 'Say which run is holding a step',
      status: 'not_started',
      kind: 'build',
      position: 50,
    });
    // Who is on it is the hand-over's to write, and only when a session is.
    expect(writes[0].row).not.toHaveProperty('assignee');

    expect(vi.mocked(handStepToClaude)).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', id: 'new-step' }),
    );
    expect(outcome.ok).toBe(true);
    expect(outcome.ok && outcome.said).toContain('#712');
    expect(outcome.ok && outcome.said).toContain('sent it to be built');
    expect(outcome.ok && outcome.said).toContain('Say which run is holding a step');
    expect(outcome.ok && outcome.redraw).toBe('/dev/plan');
  });

  // The other half of it. The hand-over refuses over timing -- a feature
  // already being worked, a re-shape rewriting it -- so the step stays on the
  // plan and the thread says it was not started and why.
  it('keeps the step and says it did not start it when the hand-over refused', async () => {
    vi.mocked(handStepToClaude).mockResolvedValueOnce({
      ok: false,
      error: '#603 is being re-read against the answers under it.',
    });
    const { writes, supabase } = db({ rows: [{ position: 40 }] });
    const outcome = await carryOut(
      input({
        supabase,
        target: 'raise',
        id: 'raise-1',
        action: action({ name: 'build_step', text: 'Say which run is holding a step', module: 'dev' }),
      }),
    );

    expect(writes).toHaveLength(1);
    expect(writes[0].row).toMatchObject({ status: 'not_started' });
    expect(outcome.ok).toBe(true);
    expect(outcome.ok && outcome.said).toContain('#712');
    expect(outcome.ok && outcome.said).toContain('did not start it');
    expect(outcome.ok && outcome.said).toContain('being re-read');
    expect(outcome.ok && outcome.redraw).toBe('/dev/plan');
  });

  // `carryOut` is handed the raise's id and nothing else, so the workspace the
  // raise is filed under is read rather than guessed at.
  it('puts it in the raise\'s own workspace when the instruction named none', async () => {
    const { writes, supabase } = db({ row: { module: 'learn' }, rows: [] });
    await carryOut(
      input({
        supabase,
        target: 'raise',
        id: 'raise-1',
        action: action({ name: 'build_step', text: 'Say which run is holding a step' }),
      }),
    );
    expect(writes[0].row).toMatchObject({ module: 'learn', position: 10 });
  });

  it('starts nothing when it cannot tell what to call it', async () => {
    const { writes, supabase } = db();
    const outcome = await carryOut(
      input({ supabase, target: 'raise', id: 'raise-1', action: action({ name: 'build_step' }) }),
    );
    expect(writes).toHaveLength(0);
    expect(outcome.ok === false && outcome.why).toContain('no step was added');
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
    for (const name of ['update_plan', 'split_feature', 'rename_module', 'fix_bug']) {
      const { writes, supabase } = db();
      const outcome = await carryOut(input({ supabase, action: action({ name }) }));
      expect(writes).toHaveLength(0);
      expect(outcome.ok).toBe(false);
      expect(outcome.ok === false && outcome.route).toBe(true);
      expect(outcome.ok === false && outcome.why).toContain(name);
    }
  });
});
