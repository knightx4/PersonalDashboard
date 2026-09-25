import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  catalogueMarkdown,
  NOT_SOURCES,
  SOURCE_SCHEMAS,
  SOURCES,
  sourceHref,
  sourceModule,
} from './catalogue';

describe('the catalogue of sources', () => {
  it('names every table once, as a source or not', () => {
    const tables = [...SOURCES.map((s) => s.table), ...NOT_SOURCES.map((n) => n.table)];
    const twice = tables.filter((t, i) => tables.indexOf(t) !== i);
    expect(twice).toEqual([]);
  });

  it('names tables as schema.table in a schema it covers', () => {
    for (const { table } of [...SOURCES, ...NOT_SOURCES]) {
      const [schema, name, extra] = table.split('.');
      expect(extra, table).toBeUndefined();
      expect(name, table).toMatch(/^[a-z_][a-z0-9_]*$/);
      expect(SOURCE_SCHEMAS, table).toContain(schema);
    }
  });

  it('says what each source holds, what to search and why a table is left out', () => {
    for (const source of SOURCES) {
      expect(source.holds.trim(), source.table).not.toBe('');
      expect(source.search.length, source.table).toBeGreaterThan(0);
    }
    for (const not of NOT_SOURCES) expect(not.reason.trim(), not.table).not.toBe('');
  });

  it('links a row to its page and names its module', () => {
    expect(sourceHref('job_search.roles', 'abc')).toBe('/jobs/roles/abc');
    expect(sourceHref('obsidian.notes', 'Career/What I want.md')).toBe('/vault/n/Career/What%20I%20want.md');
    expect(sourceHref('learn.sources', 'x')).toBeNull();
    expect(sourceModule('obsidian.notes')).toBe('Vault');
    expect(sourceModule('cashflow.deals')).toBe('cashflow');
  });

  it('matches the file the goals routine reads (run npm run sources:write)', () => {
    const file = readFileSync(join(process.cwd(), '.claude/skills/goals/reference/sources.md'), 'utf8');
    expect(file).toBe(catalogueMarkdown());
  });
});
