import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import type { AskContext } from '@/lib/ask/db';
import { HAIKU, OPUS, SONNET } from '@/lib/core/models';
import { dashModelFor, saveDashModel } from './model-choice';
import { dashModelLookup } from './model-lookup';
import { MODEL_WRITE_TOOLS } from './model-writes';
import type { DashWriteContext } from './registry';

/**
 * Dash reading and switching its own model (plan #2458.4): the tool saves
 * through the picker's saveDashModel, and the lookup reads through the
 * loader the answer uses, so the two agree with the button.
 */

const ME = '00000000-0000-4000-8000-0000000000ee';

/** A core client holding one account_settings row per user. */
function fakeCore(rows: Record<string, { dash_model: string | null }> = {}, failWrite = false) {
  const upserts: unknown[] = [];
  const client = {
    from: (table: string) => {
      expect(table).toBe('account_settings');
      return {
        select: () => ({
          eq: (_column: string, userId: string) => ({
            maybeSingle: async () => ({ data: rows[userId] ?? null, error: null }),
          }),
        }),
        upsert: async (row: { user_id: string; dash_model: string | null }) => {
          upserts.push(row);
          if (failWrite) return { error: { message: 'down' } };
          rows[row.user_id] = { dash_model: row.dash_model };
          return { error: null };
        },
      };
    },
  };
  return { client, rows, upserts };
}

function context(core: ReturnType<typeof fakeCore>): DashWriteContext & AskContext {
  return {
    userId: ME,
    today: '2026-10-20',
    timezone: 'UTC',
    enabledModules: [],
    db: async () => core.client as never,
    searchSources: [],
    seen: () => false,
    goals: async () => ({}) as never,
    createTask: async () => ({ id: null, error: 'unused' }),
  };
}

const set = MODEL_WRITE_TOOLS[0];

describe('set_dash_model', () => {
  it('saves the model asked for, and the loader reads it back', async () => {
    const core = fakeCore();
    const result = await set.apply(context(core), { model: 'haiku' });
    expect(result).toMatchObject({
      ok: true,
      kind: 'set_dash_model',
      op: 'update',
      subjectRef: `core.account_settings:${ME}`,
      before: { dash_model: null },
      after: { dash_model: HAIKU },
    });
    expect(core.upserts).toEqual([{ user_id: ME, dash_model: HAIKU }]);
    expect(await dashModelFor(core.client as never, ME)).toBe(HAIKU);
  });

  it('names the model it was on and says how to take the change back', async () => {
    const core = fakeCore({ [ME]: { dash_model: SONNET } });
    const result = await set.apply(context(core), { model: 'Opus' });
    if (!result.ok || !('summary' in result)) throw new Error('expected a write');
    expect(result.before).toEqual({ dash_model: SONNET });
    expect(result.after).toEqual({ dash_model: OPUS });
    expect(result.summary).toContain('Opus');
    expect(result.summary).toContain('Sonnet');
    expect(result.undo?.none).toBeTruthy();
  });

  it('clears the choice for "default"', async () => {
    const core = fakeCore({ [ME]: { dash_model: OPUS } });
    const result = await set.apply(context(core), { model: 'default' });
    expect(result).toMatchObject({ ok: true, after: { dash_model: null } });
    expect(await dashModelFor(core.client as never, ME)).toBe(SONNET);
  });

  it('refuses a model that is not one of the three and writes nothing', async () => {
    const core = fakeCore();
    for (const input of [{ model: 'gpt-4' }, { model: '' }, {}, null]) {
      const result = await set.apply(context(core), input);
      expect(result.ok).toBe(false);
    }
    expect(core.upserts).toEqual([]);
  });

  it('says nothing was changed when the save fails', async () => {
    const result = await set.apply(context(fakeCore({}, true)), { model: 'haiku' });
    expect(result).toEqual({ ok: false, error: 'Could not save that choice. Try again.' });
  });
});

describe('saveDashModel, which the picker and Dash share', () => {
  it('refuses an id outside the three before it reaches the database', async () => {
    const core = fakeCore();
    expect(await saveDashModel(core.client as never, ME, 'gpt-4')).toEqual({
      ok: false,
      error: 'Dash can answer with Haiku, Sonnet or Opus.',
    });
    expect(core.upserts).toEqual([]);
  });
});

describe('the dash_model lookup', () => {
  it('returns the saved model', async () => {
    const core = fakeCore({ [ME]: { dash_model: HAIKU } });
    const result = await dashModelLookup(context(core));
    expect(result).toMatchObject({ ok: true, rows: [{ title: 'Dash answers with Haiku', href: '/ask' }] });
  });

  it('says it is the default when nothing was picked', async () => {
    const result = await dashModelLookup(context(fakeCore()));
    if (!result.ok) throw new Error('expected rows');
    expect(result.rows[0].title).toBe('Dash answers with Sonnet');
    expect(result.note).toContain('default');
  });
});
