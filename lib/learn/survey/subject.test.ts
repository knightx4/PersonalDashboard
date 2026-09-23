import { describe, expect, it, vi } from 'vitest';
import { findOrCreateSubject } from '@/lib/learn/graph/save';
import { loadSurveySubjectIds, surveySubjectForTheme } from './subject';

vi.mock('@/lib/learn/areas/place-track', () => ({ placeTrackAfterResponse: vi.fn() }));

/**
 * The survey subject for a theme, against an in-memory `learn.subjects`.
 *
 * Stubbed rather than run against Postgres: what is checked here is which rows
 * get written and which are left alone. The columns and the one-subject-per-
 * theme index are in 0040_survey_subjects.sql.
 */

type Row = { id: string; user_id: string; name: string; survey: boolean; theme_id: string | null };

function fakeSubjects(initial: Row[] = []) {
  const rows = [...initial];
  let next = 0;

  const matching = (filters: ((row: Row) => boolean)[]) =>
    rows.filter((row) => filters.every((keep) => keep(row)));

  function query(filters: ((row: Row) => boolean)[] = []) {
    const found = () => matching(filters);
    return {
      eq: (column: keyof Row, value: unknown) =>
        query([...filters, (row) => row[column] === value]),
      ilike: (column: keyof Row, value: string) =>
        query([...filters, (row) => String(row[column]).toLowerCase() === value.toLowerCase()]),
      maybeSingle: async () => ({ data: found()[0] ?? null, error: null }),
      then: (resolve: (value: { data: Row[]; error: null }) => void) =>
        resolve({ data: found(), error: null }),
    };
  }

  const client = {
    from(table: string) {
      if (table !== 'subjects') throw new Error(`unexpected table ${table}`);
      return {
        select: () => query(),
        insert: (row: Omit<Row, 'id' | 'survey' | 'theme_id'> & Partial<Row>) => ({
          select: () => ({
            single: async () => {
              const clash = rows.some(
                (other) =>
                  other.name.toLowerCase() === row.name.toLowerCase() ||
                  (row.theme_id != null && other.theme_id === row.theme_id),
              );
              if (clash) return { data: null, error: { code: '23505', message: 'duplicate key' } };
              next += 1;
              const created: Row = {
                id: `subject-${next}`,
                survey: false,
                theme_id: null,
                ...row,
              };
              rows.push(created);
              return { data: { id: created.id }, error: null };
            },
          }),
        }),
        update: (patch: Partial<Row>) => ({
          eq: async (column: keyof Row, value: unknown) => {
            for (const row of rows) if (row[column] === value) Object.assign(row, patch);
            return { error: null };
          },
        }),
      };
    },
  };

  return { client: client as never, rows };
}

const USER = 'user-1';
const THEME = { id: 'theme-1', name: 'Stoicism' };

describe('surveySubjectForTheme', () => {
  it('makes a hidden subject linked to the theme, once', async () => {
    const { client, rows } = fakeSubjects();

    const first = await surveySubjectForTheme(client, USER, THEME);
    const second = await surveySubjectForTheme(client, USER, THEME);

    expect(first).toEqual({ id: 'subject-1', created: true });
    expect(second).toEqual({ id: 'subject-1', created: false });
    expect(rows).toEqual([
      { id: 'subject-1', user_id: USER, name: 'Stoicism', survey: true, theme_id: 'theme-1' },
    ]);
    expect(await loadSurveySubjectIds(client)).toEqual(new Set(['subject-1']));
  });

  it('has nothing for a theme you already have a track named after', async () => {
    const { client, rows } = fakeSubjects([
      { id: 'track', user_id: USER, name: 'stoicism', survey: false, theme_id: null },
    ]);

    expect(await surveySubjectForTheme(client, USER, THEME)).toBeNull();
    expect(rows).toHaveLength(1);
    expect(await loadSurveySubjectIds(client)).toEqual(new Set());
  });

  it('has nothing once a real track has taken the survey subject over', async () => {
    const { client } = fakeSubjects();
    const survey = await surveySubjectForTheme(client, USER, THEME);

    const track = await findOrCreateSubject(client, USER, 'Stoicism');

    expect(track).toEqual({ id: survey!.id, created: false, placed: false });
    expect(await surveySubjectForTheme(client, USER, THEME)).toBeNull();
    expect(await loadSurveySubjectIds(client)).toEqual(new Set());
  });
});
