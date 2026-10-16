import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SchemaClient } from '@/lib/ask/db';
import { OTHER_PAID_TOOLS } from './paid-tools-other';
import type { DashPaidCheckContext, DashPaidTool } from './registry';

/**
 * The checks the paid tools in Vault, News, Shopping and You make before a
 * press is queued (plan #2228.5). What each runs, and what it records, is
 * paid-actions.test.ts's.
 */

const ME = '00000000-0000-4000-8000-00000000000a';
const ROW = '00000000-0000-4000-8000-0000000000b1';
const OTHER = '00000000-0000-4000-8000-0000000000b2';

/** A client whose single reads return `row` and whose list reads return `rows`, per table. */
function reading(tables: Record<string, { row?: Record<string, unknown> | null; rows?: Record<string, unknown>[] }>): SchemaClient {
  return {
    from: (table: string) => {
      const found = tables[table] ?? {};
      const query = {
        select: () => query,
        eq: () => query,
        is: () => query,
        not: () => query,
        in: () => query,
        order: () => query,
        limit: () => query,
        maybeSingle: async () => ({ data: found.row ?? null, error: null }),
        then: (resolve: (value: unknown) => unknown) => resolve({ data: found.rows ?? [], error: null }),
      };
      return query;
    },
  } as unknown as SchemaClient;
}

function context(tables: Parameters<typeof reading>[0] = {}): DashPaidCheckContext {
  return {
    userId: ME,
    today: '2026-10-16',
    timezone: 'UTC',
    enabledModules: ['you', 'vault', 'shopping', 'news'],
    db: async () => reading(tables),
    searchSources: [],
    now: Date.parse('2026-10-16T12:00:00Z'),
    seen: () => true,
  };
}

const tool = (name: string): DashPaidTool => OTHER_PAID_TOOLS.find((t) => t.name === name)!;

describe('the other workspaces’ paid tools', () => {
  const key = process.env.ANTHROPIC_API_KEY;
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
  });
  afterEach(() => {
    if (key === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = key;
  });

  it('each names its button in its own workspace', () => {
    for (const t of OTHER_PAID_TOOLS) {
      expect(t.definition.name).toBe(t.name);
      expect(t.action.startsWith(`app/${t.workspace}/`)).toBe(true);
    }
  });

  it('reads a personality result of theirs again, and refuses one that is not', async () => {
    const read = tool('read_personality_again');
    expect(await read.prepare(context(), { result_id: 'nope' })).toMatchObject({ ok: false });
    expect(await read.prepare(context(), { result_id: ROW })).toMatchObject({ ok: false });
    expect(
      await read.prepare(context({ personality_results: { row: { id: ROW, test_name: 'Big Five' } } }), { result_id: ROW }),
    ).toEqual({
      ok: true,
      args: { resultId: ROW, name: 'Big Five' },
      line: 'Read your Big Five result again against your notes.',
      paths: ['/you/personality'],
    });
  });

  it('reads the résumé only when Jobs has one with text', async () => {
    const read = tool('read_resume_jobs');
    expect(await read.prepare(context(), {})).toMatchObject({ ok: false });
    expect(await read.prepare(context({ resume_versions: { row: { id: ROW, label: 'Main' } } }), {})).toMatchObject({
      ok: true,
      line: 'Read the jobs off your résumé Main into Work & school.',
    });
  });

  it('asks Maya about a note once, and points to the thread a note already has', async () => {
    const ask = tool('ask_maya');
    const note = { notes: { row: { id: ROW, path: 'Journal/day.md', title: null } } };
    expect(await ask.prepare(context(), { note_path: 'Journal/day.md' })).toMatchObject({ ok: false });
    expect(await ask.prepare(context(note), { note_path: 'Journal/day.md' })).toMatchObject({
      ok: true,
      args: { notePath: 'Journal/day.md', name: 'day' },
      line: 'Ask Maya about the note day.',
    });
    const asked = await ask.prepare(context({ ...note, conversations: { row: { id: OTHER } } }), { note_path: 'Journal/day.md' });
    expect(asked).toMatchObject({ ok: false });
    expect((asked as { error: string }).error).toContain(`/vault/maya/${OTHER}`);
  });

  it('prices only items of theirs marked for sale, counting each', async () => {
    const price = tool('price_items_for_sale');
    expect(await price.prepare(context(), { item_ids: [] })).toMatchObject({ ok: false });
    const one = { inventory_items: { rows: [{ id: ROW, name: 'Catan' }] } };
    expect(await price.prepare(context(one), { item_ids: [ROW, OTHER] })).toMatchObject({ ok: false });
    expect(await price.prepare(context(one), { item_ids: [ROW] })).toMatchObject({
      ok: true,
      args: { ids: [ROW] },
      count: 1,
      line: 'Look up a resale price for Catan.',
    });
  });

  it('refuses every press when the deployment has no key', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(await tool('remake_newsletter_picks').prepare(context(), {})).toMatchObject({ ok: false });
    expect(await tool('read_resume_jobs').prepare(context(), {})).toMatchObject({ ok: false });
  });
});
