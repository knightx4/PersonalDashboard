import { describe, expect, it, vi } from 'vitest';
import { findOrCreateSubject } from '@/lib/learn/graph/save';
import { loadSubjects } from '@/lib/learn/graph/load';
import { loadSurveySubjectIds, surveySubjectForAim, surveySubjectForTheme } from './subject';

vi.mock('@/lib/learn/areas/place-track', () => ({ placeTrackAfterResponse: vi.fn() }));

/**
 * The survey subject for a theme, against an in-memory `learn.subjects`.
 *
 * Stubbed rather than run against Postgres: what is checked here is which rows
 * get written and which are left alone. The columns and the one-subject-per-
 * theme index are in 0040_survey_subjects.sql.
 */

type Row = {
  id: string;
  user_id: string;
  name: string;
  survey: boolean;
  theme_id: string | null;
  aim_id?: string | null;
  note?: string | null;
  created_at?: string;
};

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
      order: () => query(filters),
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
                  (row.theme_id != null && other.theme_id === row.theme_id) ||
                  (row.aim_id != null && other.aim_id === row.aim_id),
              );
              if (clash) return { data: null, error: { code: '23505', message: 'duplicate key' } };
              next += 1;
              const created: Row = {
                id: `subject-${next}`,
                survey: false,
                theme_id: null,
                aim_id: null,
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
      { id: 'subject-1', user_id: USER, name: 'Stoicism', survey: true, theme_id: 'theme-1', aim_id: null },
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

const AIM = { id: 'aim-1', name: 'Startup finance' };

describe('surveySubjectForAim', () => {
  it('makes a hidden subject linked to the goal once, and finds it on the next call', async () => {
    const { client, rows } = fakeSubjects();

    const first = await surveySubjectForAim(client, USER, AIM);
    const second = await surveySubjectForAim(client, USER, AIM);

    expect(first).toEqual({ id: 'subject-1', created: true });
    expect(second).toEqual({ id: 'subject-1', created: false });
    expect(rows).toEqual([
      {
        id: 'subject-1',
        user_id: USER,
        name: 'Startup finance',
        survey: true,
        theme_id: null,
        aim_id: 'aim-1',
      },
    ]);
  });

  it('is left out of the list of tracks', async () => {
    const { client } = fakeSubjects([
      { id: 'track', user_id: USER, name: 'Economics', survey: false, theme_id: null },
    ]);

    const goal = await surveySubjectForAim(client, USER, AIM);

    expect((await loadSubjects(client)).map((subject) => subject.id)).toEqual(['track']);
    expect(await loadSurveySubjectIds(client)).toEqual(new Set([goal!.id]));
  });

  it('has nothing for a goal you already have a track named after', async () => {
    const { client, rows } = fakeSubjects([
      { id: 'track', user_id: USER, name: 'startup finance', survey: false, theme_id: null },
    ]);

    expect(await surveySubjectForAim(client, USER, AIM)).toBeNull();
    expect(rows).toHaveLength(1);
  });

  it('links a hidden subject of the same name to the goal instead of making another', async () => {
    const { client, rows } = fakeSubjects([
      { id: 'theme-subject', user_id: USER, name: 'Startup finance', survey: true, theme_id: 'theme-9' },
    ]);

    expect(await surveySubjectForAim(client, USER, AIM)).toEqual({
      id: 'theme-subject',
      created: false,
    });
    expect(await surveySubjectForAim(client, USER, AIM)).toEqual({
      id: 'theme-subject',
      created: false,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ survey: true, theme_id: 'theme-9', aim_id: 'aim-1' });
  });

  it('has nothing once a real track has taken the goal subject over', async () => {
    const { client } = fakeSubjects();
    const survey = await surveySubjectForAim(client, USER, AIM);

    const track = await findOrCreateSubject(client, USER, 'Startup finance');

    expect(track).toEqual({ id: survey!.id, created: false, placed: false });
    expect(await surveySubjectForAim(client, USER, AIM)).toBeNull();
  });
});
