import { describe, expect, it } from 'vitest';
import { carryOut, type ActInput } from './act';

type Insert = { table: string; row: Record<string, unknown> };

/** A client that records what it was asked to write, and can be made to fail. */
function db(error: { message: string } | null = null) {
  const writes: Insert[] = [];
  const supabase = {
    from(table: string) {
      return {
        insert(row: Record<string, unknown>) {
          writes.push({ table, row });
          return Promise.resolve({ error });
        },
      };
    },
  };
  return { writes, supabase: supabase as unknown as ActInput['supabase'] };
}

function input(over: Partial<ActInput> & { action: ActInput['action'] }): ActInput {
  const { supabase } = db();
  return {
    supabase,
    userId: 'user-1',
    target: 'step',
    id: 'row-1',
    ...over,
  };
}

describe('carrying out an instruction from a comment', () => {
  it('files an idea, as a suggestion under the row it came from', async () => {
    const { writes, supabase } = db();
    const outcome = await carryOut(
      input({
        supabase,
        action: { name: 'file_idea', text: 'Let a note be filed from a keyboard shortcut.', module: 'vault' },
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
    if (!outcome.ok) return;
    expect(outcome.said).toContain('Let a note be filed from a keyboard shortcut.');
    expect(outcome.said).toContain('Vault');
  });

  it('points an idea at no step when the comment was not on one', async () => {
    const { writes, supabase } = db();
    await carryOut(input({ supabase, target: 'idea', action: { name: 'file_idea', text: 'Two ideas can merge.', module: null } }));
    expect(writes[0].row.from_plan_item_id).toBeNull();
  });

  it('reads a workspace nothing can look up as the app as a whole', async () => {
    const { writes, supabase } = db();
    const outcome = await carryOut(
      input({ supabase, action: { name: 'file_idea', text: 'A search box everywhere.', module: 'not-a-module' } }),
    );
    expect(writes[0].row.module).toBeNull();
    expect(outcome.ok && outcome.said).toContain('the app as a whole');
  });

  it('writes nothing when it cannot tell what to file', async () => {
    const { writes, supabase } = db();
    const outcome = await carryOut(input({ supabase, action: { name: 'file_idea', text: null, module: null } }));
    expect(writes).toHaveLength(0);
    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.why).toContain('nothing was written down');
  });

  it('says so when the write itself fails', async () => {
    const { supabase } = db({ message: 'new row violates row-level security policy' });
    const outcome = await carryOut(input({ supabase, action: { name: 'file_idea', text: 'Anything.', module: null } }));
    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.why).toContain('row-level security');
  });

  it('refuses anything outside the list, and says whose move it is', async () => {
    for (const name of ['approve_step', 'answer_decision', 'dismiss', 'delete_row', 'set_status']) {
      const { writes, supabase } = db();
      const outcome = await carryOut(input({ supabase, action: { name, text: null, module: null } }));
      expect(writes).toHaveLength(0);
      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.why).toContain(name);
      expect(outcome.why).toContain('yours to make on the page');
    }
  });
});
