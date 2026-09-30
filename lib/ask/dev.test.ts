import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ModuleId } from '@/lib/modules';
import type { AskContext, SchemaClient } from './db';
import { SECTION_CHARS, queryWords } from './dev';
import { executeAskTool } from './tools';

/**
 * read_spec (plan #1322) against a fixture spec: the file is read through
 * `ctx.readSpec`, and the owner check through a stubbed `is_owner` rpc.
 */

const FIXTURE = path.join(__dirname, 'fixtures', 'spec.md');
const ALL_MODULES: ModuleId[] = ['shopping', 'jobs', 'vault', 'todo', 'learn', 'news', 'goals', 'dev'];

function context({ owner = true, modules = ALL_MODULES } = {}): AskContext & { rpcs: string[] } {
  const rpcs: string[] = [];
  return {
    rpcs,
    userId: '00000000-0000-4000-8000-00000000000a',
    today: '2026-09-30',
    enabledModules: modules,
    db: async () =>
      ({
        rpc: async (fn: string) => {
          rpcs.push(fn);
          return fn === 'is_owner' ? { data: owner, error: null } : { data: null, error: { message: 'no' } };
        },
      }) as unknown as SchemaClient,
    searchSources: [],
    readSpec: () => readFile(FIXTURE, 'utf8'),
  };
}

describe('read_spec', () => {
  it('returns the section a query is about, with its text and a link to it on the spec page', async () => {
    const result = await executeAskTool('read_spec', { spec: 'writing', query: 'what the writing guide says about em dashes' }, context());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(1);
    const [row] = result.rows;
    expect(row).toMatchObject({
      table: 'docs.specs',
      ref: 'writing#punctuation',
      title: 'Professional writing guide: Punctuation',
      href: '/dev/specs/writing#punctuation',
    });
    expect(row.detail?.text).toContain('Use em dashes sparingly');
  });

  it('lists the headings when the query matches nothing, or there is no query', async () => {
    for (const input of [{ spec: 'writing', query: 'zeppelins' }, { spec: 'writing' }]) {
      const result = await executeAskTool('read_spec', input, context());
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.rows.map((row) => row.detail?.section)).toEqual(['opening', 'punctuation', 'structure', 'long-section']);
      expect(result.rows.every((row) => row.detail?.text === undefined)).toBe(true);
    }
  });

  it('reads one section by its anchor, or by the ref an earlier read returned', async () => {
    const bySection = await executeAskTool('read_spec', { spec: 'writing', section: 'structure' }, context());
    const byRef = await executeAskTool('read_spec', { spec: 'writing#structure' }, context());
    for (const result of [bySection, byRef]) {
      expect(result.ok && result.rows.map((row) => row.ref)).toEqual(['writing#structure']);
    }
  });

  it('cuts a long section from the paragraph that matches', async () => {
    const result = await executeAskTool('read_spec', { spec: 'writing', query: 'expiry rule' }, context());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const text = String(result.rows[0].detail?.text);
    expect(text.startsWith('… The expiry rule')).toBe(true);
    expect(text.length).toBeLessThanOrEqual(SECTION_CHARS + 6);
    expect(result.note).toContain('cut');
  });

  it('gives another account nothing, and nothing with the Dev workspace off', async () => {
    const other = await executeAskTool('read_spec', { spec: 'writing', query: 'em dashes' }, context({ owner: false }));
    expect(other).toEqual({ ok: false, error: expect.stringContaining('not the owner') });

    const off = context({ modules: ['shopping'] });
    expect(await executeAskTool('read_spec', { spec: 'writing' }, off)).toEqual({
      ok: false,
      error: expect.stringContaining('Dev workspace is switched off'),
    });
    expect(off.rpcs).toEqual([]);
  });

  it('refuses a spec that is not on the specs page', async () => {
    const result = await executeAskTool('read_spec', { spec: 'SETUP.md' }, context());
    expect(result).toEqual({ ok: false, error: expect.stringContaining('There is no spec called SETUP.md') });
  });
});

describe('queryWords', () => {
  it('keeps two-letter words such as "em" and drops the question around the topic', () => {
    expect(queryWords('What does it say about em dashes?')).toEqual(['em', 'dashes']);
  });
});
