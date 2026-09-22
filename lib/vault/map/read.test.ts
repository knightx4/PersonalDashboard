import { describe, expect, it } from 'vitest';
import {
  shapePositions,
  shapeThemeList,
  shapeThemeNotes,
  type RawThemePosition,
} from './read';

const note = (title: string, deleted = false) => ({
  path: `Notes/${title}.md`,
  title,
  deleted_at: deleted ? '2026-09-01T00:00:00Z' : null,
});

const position = (
  name: string,
  sources: { quote: string; notes: ReturnType<typeof note> | null }[],
  centrality: number | string = 0,
): RawThemePosition => ({
  positions: {
    id: name,
    name,
    statement: `${name} statement`,
    basis: 'From the intro.',
    kind: 'claim',
    stance: 'held',
    centrality,
    ungrounded_at: null,
    position_sources: sources,
  },
});

describe('shapeThemeList', () => {
  it('reads the embedded counts, and zero when absent', () => {
    expect(
      shapeThemeList([
        { id: 'a', name: 'A', about: 'x', theme_notes: [{ count: 3 }], theme_positions: [{ count: 5 }] },
        { id: 'b', name: 'B', about: 'y', theme_notes: [], theme_positions: null },
      ]),
    ).toEqual([
      { id: 'a', name: 'A', about: 'x', notes: 3, positions: 5 },
      { id: 'b', name: 'B', about: 'y', notes: 0, positions: 0 },
    ]);
  });
});

describe('shapePositions', () => {
  it('orders by centrality, then sources, then name', () => {
    const rows = [
      position('Zed', [{ quote: 'q', notes: note('One') }]),
      position('Alpha', [{ quote: 'q', notes: note('One') }]),
      position('Many', [
        { quote: 'q1', notes: note('One') },
        { quote: 'q2', notes: note('Two') },
      ]),
      position('Central', [], '2.5'),
      { positions: null },
    ];
    expect(shapePositions(rows).map((p) => p.name)).toEqual(['Central', 'Many', 'Alpha', 'Zed']);
  });

  it('keeps a quote whose note left the vault, without a link, last', () => {
    const [shaped] = shapePositions([
      position('P', [
        { quote: 'gone', notes: note('Removed', true) },
        { quote: 'here', notes: note('Kept') },
      ]),
    ]);
    expect(shaped.sources).toEqual([
      { quote: 'here', note: { path: 'Notes/Kept.md', title: 'Kept' } },
      { quote: 'gone', note: null },
    ]);
  });
});

describe('shapeThemeNotes', () => {
  it('drops removed notes and sorts by title', () => {
    expect(
      shapeThemeNotes([
        { basis: 'b', notes: note('Beta') },
        { basis: 'gone', notes: note('Gone', true) },
        { basis: 'a', notes: note('Alpha') },
        { basis: 'none', notes: null },
      ]),
    ).toEqual([
      { path: 'Notes/Alpha.md', title: 'Alpha', basis: 'a' },
      { path: 'Notes/Beta.md', title: 'Beta', basis: 'b' },
    ]);
  });
});
