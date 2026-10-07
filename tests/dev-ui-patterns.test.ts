/**
 * Part 4 of docs/UI-QUALITY-SPEC.md: each page pattern has a component, a
 * gallery entry and a rule on /dev/ui (plan #1545).
 *
 * Read from source rather than imported, since app/dev/ui/patterns.tsx draws
 * its fixtures with the thread, whose server actions a node test cannot load.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SURFACE_ROUTES } from '@/lib/preview/routes';

const root = process.cwd();
const source = readFileSync(join(root, 'app/dev/ui/patterns.tsx'), 'utf8');
const list = source.slice(source.indexOf('export const PATTERNS'));

/** Each pattern's entry, cut at the next pattern's id. */
const entries = list
  .split(/\n {4}id: '/)
  .slice(1)
  .map((chunk) => ({
    id: chunk.slice(0, chunk.indexOf("'")),
    name: chunk.match(/\n {4}name: '([^']+)'/)?.[1] ?? '',
    rule: chunk.match(/\n {4}rule:\s*\n?\s*['"]([^'"]+)['"]/)?.[1] ?? '',
    path: chunk.match(/path: '([^']+)'/)?.[1] ?? '',
    exports: [...(chunk.match(/exports: \[([^\]]*)\]/)?.[1] ?? '').matchAll(/'(\w+)'/g)].map(
      (m) => m[1],
    ),
    surfaces: [...chunk.matchAll(/\bid: '(pattern-[\w-]+)'/g)].map((m) => m[1]),
  }));

describe('the page patterns on /dev/ui', () => {
  it('holds the three from the spec', () => {
    expect(entries.map((e) => e.name)).toEqual(['list and detail', 'deck', 'thread']);
  });

  it.each(entries)('gives $id a rule, a component and a gallery entry', (entry) => {
    expect(entry.rule.length).toBeGreaterThan(40);
    expect(existsSync(join(root, entry.path)), entry.path).toBe(true);
    const component = readFileSync(join(root, entry.path), 'utf8');
    for (const name of entry.exports) {
      expect(component, `${entry.path} exports ${name}`).toMatch(
        new RegExp(`export (function|type|const) ${name}\\b`),
      );
    }
    expect(entry.surfaces.length).toBeGreaterThan(0);
    for (const id of entry.surfaces) expect(SURFACE_ROUTES[id], id).toEqual(['/dev/ui']);
  });

  it('declares the deck to the phone checks', () => {
    expect(list).toMatch(/deck: \{ next: '\[data-deck-next\]', item: '\[data-deck-item\]' \}/);
    const deck = readFileSync(join(root, 'components/patterns/deck.tsx'), 'utf8');
    expect(deck).toContain('data-deck-next');
    expect(deck).toContain('data-deck-item');
  });
});
