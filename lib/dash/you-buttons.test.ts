import { describe, expect, it, vi } from 'vitest';
import type { SchemaClient } from '@/lib/ask/db';
import { fakeSchemaDb, type FakeTables } from '../../tests/stubs/fake-schema-db';

/**
 * Each You tool writes the rows its button writes (plan #2473.5): a place
 * and a job corrected, a course corrected and a transcript kept on Work &
 * school. The button's own server action runs on one copy of the person's
 * rows, the tool on another, from the same input, and the two copies are
 * compared.
 */

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));

const ME = '00000000-0000-4000-8000-0000000000aa';
const state = vi.hoisted(() => ({ tables: {} as Record<string, Record<string, unknown>[]> }));

/** The you client, with a transcripts bucket that takes any upload. */
function youClient(tables: FakeTables): SchemaClient {
  const you = fakeSchemaDb(tables)('you');
  return Object.assign(you, {
    storage: {
      from: () => ({
        upload: async (path: string) => ({ data: { path }, error: null }),
        remove: async () => ({ data: [], error: null }),
      }),
    },
  });
}

vi.mock('@/lib/auth/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/server')>()),
  requireUser: async () => ({ id: '00000000-0000-4000-8000-0000000000aa' }),
}));
vi.mock('@/lib/you/auth/server', () => ({ createYouClient: async () => youClient(state.tables) }));

const places = await import('@/app/you/places/actions');
const jobs = await import('@/app/you/work/job-actions');
const work = await import('@/app/you/work/actions');
const { YOU_WRITES, runYouWrite } = await import('./you-writes');
const { VAULT_WRITES, runVaultWrite } = await import('./vault-writes');

const PLACE = '11111111-1111-4111-8111-111111111111';
const JOB = '22222222-2222-4222-8222-222222222222';
const TRANSCRIPT = '33333333-3333-4333-8333-333333333333';
const COURSE = '44444444-4444-4444-8444-444444444444';

const place = {
  id: PLACE,
  user_id: ME,
  name: 'The flat on Hyde Park Road',
  city: 'Leeds',
  region: null,
  country: 'United Kingdom',
  moved_in: '2015',
  moved_out: '2019',
  note: null,
  latitude: null,
  longitude: null,
};
const job = { id: JOB, user_id: ME, employer: 'The corner bookshop', title: 'Clerk', place: null, started: '2014', ended: '2016', note: null, edited: false };
const course = {
  id: COURSE,
  user_id: ME,
  transcript_id: TRANSCRIPT,
  school: 'Leeds',
  code: 'PH101',
  title: 'Ethics',
  term: 'Autumn',
  year: 2015,
  credits: 10,
  grade: 'B',
  position: 0,
};

function twins(seed: FakeTables): [FakeTables, FakeTables] {
  return [structuredClone(seed), structuredClone(seed)];
}

async function press<T>(tables: FakeTables, act: () => Promise<T>): Promise<T> {
  state.tables = tables;
  return act();
}

/** The rows as the database holds them, less what each insert makes up for itself. */
function rows(tables: FakeTables, key: string, drop: string[] = []): Record<string, unknown>[] {
  return (tables[key] ?? []).map((row) => {
    const rest = { ...row };
    for (const column of ['id', 'created_at', ...drop]) delete rest[column];
    return rest;
  });
}

async function youTool(name: string, tables: FakeTables, input: Record<string, unknown>) {
  const made = await runYouWrite(YOU_WRITES.find((entry) => entry.name === name)!, { userId: ME, you: youClient(tables) }, input);
  if ('ok' in made) throw new Error(made.error);
  return made;
}

async function workTool(name: string, tables: FakeTables, input: Record<string, unknown>) {
  const db = fakeSchemaDb(tables);
  const write = VAULT_WRITES.find((entry) => entry.name === name)!;
  const made = await runVaultWrite(
    write,
    { userId: ME, vault: db('obsidian'), core: db('core'), you: youClient(tables), notes: undefined as never },
    input,
  );
  if ('ok' in made) throw new Error(made.error);
  return made;
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

describe('the You tools write what their buttons write', () => {
  it('change_place changes the place as its edit form does', async () => {
    const [page, dash] = twins({ 'you.places': [place] });
    await press(page, () =>
      places.savePlace(
        {},
        form({ id: PLACE, name: place.name, city: 'Sheffield', region: '', country: 'United Kingdom', moved_in: '2015', moved_out: '2018', note: '' }),
      ),
    );
    await youTool('change_place', dash, { place_ref: PLACE, city: 'Sheffield', moved_out: '2018' });
    expect(dash['you.places']).toEqual(page['you.places']);
    expect(dash['you.places'][0]).toMatchObject({ city: 'Sheffield', moved_out: '2018' });
  });

  it('save_job corrects a job as the form does, and marks it theirs', async () => {
    const [page, dash] = twins({ 'you.work_history': [job] });
    expect(
      await press(page, () =>
        jobs.saveJobAction({}, form({ id: JOB, employer: job.employer, title: 'Manager', place: '', started: '2014', ended: '2016', note: '' })),
      ),
    ).toEqual({ saved: true });
    await youTool('save_job', dash, { job_ref: JOB, title: 'Manager' });
    expect(dash['you.work_history']).toEqual(page['you.work_history']);
    expect(dash['you.work_history'][0]).toMatchObject({ title: 'Manager', edited: true });
  });

  it('save_job adds a job as the form does', async () => {
    const [page, dash] = twins({ 'you.work_history': [] });
    const fields = { employer: 'The library', title: 'Assistant', place: 'Leeds', started: '2017', ended: '', note: '' };
    expect(await press(page, () => jobs.saveJobAction({}, form(fields)))).toEqual({ saved: true });
    await youTool('save_job', dash, { employer: 'The library', title: 'Assistant', place: 'Leeds', started: '2017' });
    expect(rows(dash, 'you.work_history')).toEqual(rows(page, 'you.work_history'));
  });

  it('change_course corrects the course as its edit form does', async () => {
    const [page, dash] = twins({ 'you.courses': [course] });
    expect(
      await press(page, () =>
        work.updateCourseAction(
          {},
          form({ id: COURSE, school: 'Leeds', code: 'PH101', title: 'Ethics', term: 'Autumn', year: '2015', credits: '10', grade: 'A' }),
        ),
      ),
    ).toEqual({ saved: true });
    await workTool('change_course', dash, { course_ref: COURSE, grade: 'A' });
    expect(dash['you.courses']).toEqual(page['you.courses']);
    expect(dash['you.courses'][0].grade).toBe('A');
  });

  it('save_transcript keeps the transcript and its courses as the check list does', async () => {
    const [page, dash] = twins({ 'you.transcripts': [], 'you.courses': [] });
    const path = `${ME}/${'5'.repeat(8)}-5555-4555-8555-${'5'.repeat(12)}-transcript.pdf`;
    const saved = await press(page, () =>
      work.saveTranscriptAction(
        {},
        form({
          path,
          fileName: 'transcript.pdf',
          sizeBytes: '2048',
          school: 'Leeds',
          rows: '0,1',
          'course.0.title': 'Ethics',
          'course.0.code': 'PH101',
          'course.0.grade': 'B',
          'course.1.title': 'Logic',
          'course.1.credits': '10',
        }),
      ),
    );
    expect(saved).toEqual({ saved: { school: 'Leeds', courses: 2 } });
    await workTool('save_transcript', dash, {
      school: 'Leeds',
      text: 'Ethics PH101 B\nLogic 10',
      courses: [
        { title: 'Ethics', code: 'PH101', grade: 'B' },
        { title: 'Logic', credits: '10' },
      ],
    });
    expect(rows(dash, 'you.courses', ['transcript_id'])).toEqual(rows(page, 'you.courses', ['transcript_id']));
    const file = ['storage_path', 'file_name', 'mime_type', 'size_bytes'];
    expect(rows(dash, 'you.transcripts', file)).toEqual(rows(page, 'you.transcripts', file));
    expect(dash['you.transcripts']).toHaveLength(1);
  });
});
