import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Figure } from '@/components/learn/figure';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { readLessonReport } from '@/lib/learn/lessons/write-lesson';
import { NOT_BUILT_LINE, wantedKind } from './kinds/wanted';
import { matchNeed, needText, readVector, recordFigureNeeds, wantedFigures } from './needs';
import { readStoredFigures, readWrittenFigures } from './registry';
import type { FigureBlock } from './types';

const wanted = (shows: string, need = 'data_source'): FigureBlock => ({
  kind: 'wanted',
  caption: 'How commuting reach grew with the Underground.',
  spec: { need, shows, why: 'The pace of the change is the point.' },
});

describe('a wanted figure (plan #2321.9)', () => {
  it('is written, stored and read back like any figure', () => {
    const [block] = readWrittenFigures([wanted('The share of Londoners within 30 minutes of the City, 1863 to 2023.')]);
    expect(block.kind).toBe('wanted');
    expect(readStoredFigures([block])).toEqual([block]);
  });

  it('is refused when it names no need the app knows', () => {
    expect(readWrittenFigures([wanted('A thing.', 'video')])).toEqual([]);
    expect(readWrittenFigures([{ ...wanted('x'), spec: { need: 'model', shows: '', why: 'x' } }])).toEqual([]);
  });

  it('comes through the lesson report', () => {
    const report = readLessonReport(
      {
        can_teach: true,
        claim: 'A claim.',
        context: 'Some context.',
        evidence: 'A number.',
        why: 'A reason.',
        example: 'A case.',
        figures: [wanted('A line of reach by year.')],
      },
      false,
    );
    expect(report).toMatchObject({ verdict: 'ready', figures: [{ kind: 'wanted' }] });
  });

  it('draws its caption and the not-built line, never folded', () => {
    const html = renderToStaticMarkup(<Figure figure={{ kind: 'wanted', ...wantedKind.example }} />);
    expect(html).toContain(NOT_BUILT_LINE);
    expect(html).not.toContain('<details');
  });
});

describe('grouping needs', () => {
  const v = (...xs: number[]) => xs;

  it('joins the closest earlier need at or above the floor', () => {
    const known = [
      { key: 'a', text: 'x', vector: v(1, 0, 0) },
      { key: 'b', text: 'y', vector: v(0.9, 0.1, 0) },
    ];
    expect(matchNeed({ text: 'z', vector: v(0.9, 0.12, 0) }, known)).toBe('b');
    expect(matchNeed({ text: 'z', vector: v(0, 0, 1) }, known)).toBeNull();
  });

  it('without vectors joins only an identical description', () => {
    const known = [{ key: 'a', text: 'A data source: Rent by distance', vector: null }];
    expect(matchNeed({ text: 'a data source: rent by distance ', vector: null }, known)).toBe('a');
    expect(matchNeed({ text: 'A data source: rent by year', vector: null }, known)).toBeNull();
  });

  it('reads stored vectors and the wanted blocks of a lesson', () => {
    expect(readVector('[0.5,1]')).toEqual([0.5, 1]);
    expect(readVector('junk')).toBeNull();
    const figures = [{ kind: 'table', caption: 'T.', spec: {} }, wanted('Reach by year.')];
    expect(wantedFigures(figures)).toEqual([{ ordinal: 1, caption: figures[1].caption, spec: figures[1].spec }]);
    expect(needText({ need: 'model', shows: ' A  model. ' })).toBe('A model: A model.');
  });
});

/** A figure_needs table in memory, enough for recordFigureNeeds. */
function fakeLearn() {
  const rows: Record<string, unknown>[] = [];
  const client = {
    from() {
      const filters: [string, unknown][] = [];
      const query = {
        select: () => query,
        eq: (column: string, value: unknown) => (filters.push([column, value]), query),
        order: () => query,
        limit: async () => ({ data: rows.filter((row) => filters.every(([c, val]) => row[c] === val)), error: null }),
        upsert: async (row: Record<string, unknown>) => {
          if (!rows.some((r) => r.card_id === row.card_id && r.ordinal === row.ordinal)) rows.push(row);
          return { error: null };
        },
      };
      return query;
    },
  };
  return { rows, learn: client as unknown as LearnSupabaseClient };
}

describe('recording a lesson’s needs', () => {
  const user = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
  const vectors: Record<string, number[]> = {
    'A data source: Reach by year.': [1, 0],
    'A data source: How far Londoners could commute, by year.': [0.97, 0.05],
    'A data source: Rents by borough.': [0, 1],
  };
  const embed = async (text: string) => (vectors[text] ? { vector: vectors[text], model: 'voyage-test' } : null);
  let n = 0;
  const id = () => `need-${++n}`;

  it('groups a second lesson asking for the same thing under the first one’s key', async () => {
    const { rows, learn } = fakeLearn();
    const first = await recordFigureNeeds(learn, { userId: user, subjectId: 's', cardId: 'c1', figures: [wanted('Reach by year.')] }, embed, id);
    const again = await recordFigureNeeds(
      learn,
      { userId: user, subjectId: 's2', cardId: 'c2', figures: [wanted('How far Londoners could commute, by year.')] },
      embed,
      id,
    );
    const other = await recordFigureNeeds(learn, { userId: user, subjectId: 's', cardId: 'c3', figures: [wanted('Rents by borough.')] }, embed, id);
    expect([first.recorded, again.recorded, other.recorded]).toEqual([1, 1, 1]);
    expect(rows[1].key).toBe(rows[0].id);
    expect(rows[0].key).toBe(rows[0].id);
    expect(rows[2].key).toBe(rows[2].id);
    expect(rows[0].embedding).toBe('[1,0]');
  });

  it('records a lesson’s block once', async () => {
    const { rows, learn } = fakeLearn();
    const input = { userId: user, subjectId: 's', cardId: 'c1', figures: [wanted('Reach by year.')] };
    await recordFigureNeeds(learn, input, embed, id);
    await recordFigureNeeds(learn, input, embed, id);
    expect(rows).toHaveLength(1);
  });
});
