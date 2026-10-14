import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MODULES } from '@/lib/modules';
import {
  catalogueMarkdown,
  NOT_SOURCES,
  PAGES,
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

  it('puts every page under a section of its workspace’s nav', () => {
    const root = process.cwd();
    for (const { table, page } of PAGES) {
      const { section } = page;
      // Null is a row that sits under another; it has to say which.
      if (section === null) {
        expect(page.parent, table).toBeDefined();
        continue;
      }
      const workspace = MODULES.find((m) => section.href === m.prefix || section.href.startsWith(`${m.prefix}/`));
      if (!workspace) {
        // The app's own pages, outside every workspace: the page has to exist.
        expect(existsSync(join(root, 'app', section.href, 'page.tsx')), `${table}: ${section.href}`).toBe(true);
        continue;
      }
      if (section.href === workspace.settings?.href) {
        expect(section.label, table).toBe('Settings');
        continue;
      }
      const layout = [`app${workspace.prefix}/layout.tsx`, `app${workspace.prefix}/(app)/layout.tsx`].find((f) =>
        existsSync(join(root, f)),
      );
      expect(layout, `${table}: no layout for ${workspace.id}`).toBeDefined();
      const text = readFileSync(join(root, layout!), 'utf8');
      expect(text, `${table}: ${section.href} is not a tab in ${layout}`).toContain(`href: '${section.href}'`);
      expect(text, `${table}: ${section.label} is not a tab in ${layout}`).toContain(`label: '${section.label}'`);
    }
  });
});
