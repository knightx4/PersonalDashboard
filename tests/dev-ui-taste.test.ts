/**
 * R5 of docs/UI-QUALITY-SPEC.md: every preference names the note it came
 * from. A preference with no source is a guess at the person's taste, and
 * the design critic would hold every screen to it as though they had asked.
 *
 * Also checks that each entry's example is a surface in the gallery, since
 * the critic and /dev/ui both point at it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { describeSources, TASTE, type Taste } from '../app/dev/ui/taste';

/** Surface ids, read from the gallery's source rather than imported, since
 * importing it renders half the app's components into a node test. */
const gallery = readFileSync(join(process.cwd(), 'app/preview/surfaces.tsx'), 'utf8');
const SURFACE_IDS = new Set(
  [...gallery.slice(gallery.indexOf('export const SURFACES')).matchAll(/^\s+id: '([^']+)'/gm)].map(
    (m) => m[1],
  ),
);

/** What is wrong with an entry, or nothing. */
function problems(taste: Taste, today = new Date()): string[] {
  const out: string[] = [];
  if (!taste.sentence.trim()) out.push('no sentence');
  if (taste.sources.length === 0) out.push('names no source');
  for (const s of taste.sources) {
    if (!s.where.trim()) out.push('a source with no place');
    const day = /^\d{4}-\d{2}-\d{2}$/.test(s.on) ? new Date(`${s.on}T00:00:00Z`) : null;
    if (!day || Number.isNaN(day.getTime())) out.push(`source date "${s.on}" is not YYYY-MM-DD`);
    else if (day > today) out.push(`source date ${s.on} is in the future`);
  }
  if (!SURFACE_IDS.has(taste.example)) out.push(`example "${taste.example}" is not a gallery surface`);
  return out;
}

describe('the preferences on /dev/ui', () => {
  it('holds the fourteen from the spec', () => {
    expect(TASTE.length).toBeGreaterThanOrEqual(14);
  });

  it('gives every entry a source, a date and a real example', () => {
    const bad = TASTE.map((t) => [t.id, problems(t)] as const).filter(([, p]) => p.length > 0);
    expect(bad).toEqual([]);
  });

  it('fails an entry that names no source', () => {
    const sourceless: Taste = { ...TASTE[0], id: 'x', sources: [] };
    expect(problems(sourceless)).toContain('names no source');
  });

  it('keeps ids unique', () => {
    expect(new Set(TASTE.map((t) => t.id)).size).toBe(TASTE.length);
  });

  it('reads the sources the way the spec writes them', () => {
    expect(
      describeSources([
        { where: 'News', on: '2026-09-24' },
        { where: 'News', on: '2026-09-27' },
        { where: 'News', on: '2026-10-02' },
      ]),
    ).toBe('News, 24 and 27 Sep, 2 Oct');
    expect(
      describeSources([
        { where: 'Learn', on: '2026-09-24' },
        { where: 'Contact page', on: '2026-09-29' },
      ]),
    ).toBe('Learn, 24 Sep; Contact page, 29 Sep');
  });
});
