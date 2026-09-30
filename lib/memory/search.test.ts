import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MEMORY_SOURCE_MODULES,
  groupByRow,
  memorySourcesFor,
  splitPassage,
  type MemoryPassage,
} from './search';

/**
 * The pure parts of the meaning search (plan #1248). The lookup that calls it
 * is tested in lib/ask/tools.test.ts with a fake embedder.
 */

const MIGRATIONS = join(__dirname, '..', '..', 'supabase', 'migrations');

/** The source_table values the newest core.memory_sources emits. */
function sqlSourceTables(): string[] {
  const defining = readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => readFileSync(join(MIGRATIONS, name), 'utf8'))
    .filter((sql) => /create or replace function core\.memory_sources\(/.test(sql));
  const sql = defining.at(-1)!;
  const body = sql.slice(sql.indexOf('create or replace function core.memory_sources('));
  const fn = body.slice(0, body.indexOf('$$;'));
  return [...fn.matchAll(/select \w+\.(?:user_id|id), '([a-z_]+\.[a-z_]+)'/g)].map((m) => m[1]);
}

describe('the sources recall searches', () => {
  it('names a workspace for every table core.memory_sources embeds', () => {
    const tables = sqlSourceTables();
    expect(tables.length).toBeGreaterThanOrEqual(11);
    expect(tables.filter((table) => !(table in MEMORY_SOURCE_MODULES))).toEqual([]);
  });

  it('leaves out the tables of a switched-off workspace and keeps files', () => {
    const sources = memorySourcesFor(['jobs', 'goals']);
    expect(sources).toContain('job_search.thoughts');
    expect(sources).toContain('goals.items');
    expect(sources).toContain('core.files');
    expect(sources).not.toContain('obsidian.notes');
    expect(sources).not.toContain('learn.aims');
    expect(sources).not.toContain('public.order_items');
  });
});

describe('groupByRow', () => {
  const p = (ref: string, chunkIndex: number, similarity: number): MemoryPassage => ({
    sourceTable: 'obsidian.notes',
    sourceRef: ref,
    chunkIndex,
    author: 'me',
    body: `${ref}\n\ntext ${chunkIndex}`,
    similarity,
  });

  it('puts each row once, in order of its closest passage, with its passages closest first', () => {
    const rows = groupByRow([p('a', 0, 0.4), p('b', 0, 0.6), p('a', 3, 0.5)]);
    expect(rows.map((r) => [r.sourceRef, r.similarity])).toEqual([
      ['b', 0.6],
      ['a', 0.5],
    ]);
    expect(rows[1].passages.map((x) => x.chunkIndex)).toEqual([3, 0]);
  });
});

describe('splitPassage', () => {
  it('takes the title off the front of a passage', () => {
    expect(splitPassage('Land Value Tax\n\nEstimated $20T of land value.')).toEqual({
      title: 'Land Value Tax',
      text: 'Estimated $20T of land value.',
    });
  });

  it('reads a passage that is only a title as a title', () => {
    expect(splitPassage('Pay off student debt')).toEqual({ title: 'Pay off student debt', text: '' });
  });

  it('keeps a passage whose first paragraph is too long to be a title whole', () => {
    const body = `${'word '.repeat(60)}\n\nmore`;
    expect(splitPassage(body)).toEqual({ title: null, text: body });
  });
});
