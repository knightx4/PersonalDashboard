import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { fakeSchemaDb, type FakeTables } from '../../tests/stubs/fake-schema-db';

/**
 * Each Learn tool writes the rows its button writes (plan #2473.5): a
 * reading's status, shelf, note, text and link, a new list, a reading added
 * to one, a note on an idea or a card, and a video marked watched. The
 * button's own server action runs on one copy of the person's rows, the tool
 * on another, from the same input, and the two copies are compared. Another
 * account's rows sit beside them, as they do for the connector's service
 * role, and neither side may touch them.
 */

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('@/lib/learn/youtube/video-card-run', () => ({ settleVideoCards: vi.fn(async () => ({ withdrawn: 0, revived: 0 })) }));

const ME = '00000000-0000-4000-8000-0000000000aa';
const THEM = '00000000-0000-4000-8000-0000000000bb';
const state = vi.hoisted(() => ({ tables: {} as Record<string, Record<string, unknown>[]> }));

vi.mock('@/lib/auth/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/server')>()),
  requireUser: async () => ({ id: '00000000-0000-4000-8000-0000000000aa' }),
}));
vi.mock('@/lib/dev/owner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/dev/owner')>()),
  requireOwner: async () => ({ id: '00000000-0000-4000-8000-0000000000aa' }),
}));
vi.mock('@/lib/learn/auth/server', async () => {
  const { fakeSchemaDb: fake } = await import('../../tests/stubs/fake-schema-db');
  return { createLearnClient: async () => fake(state.tables)('learn') };
});
vi.mock('@/lib/learn/tracks/link', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/learn/tracks/link')>()),
  fetchLinkMeta: async () => ({ title: 'The Illustrated Transformer', author: null }),
}));

const readingPage = await import('@/app/learn/r/[id]/actions');
const lists = await import('@/app/learn/lists/actions');
const trackPage = await import('@/app/learn/t/[id]/actions');
const savePage = await import('@/app/learn/save/actions');
const ideaPage = await import('@/app/learn/c/[id]/actions');
const nowPage = await import('@/app/learn/now/actions');
const videos = await import('@/app/learn/videos/actions');
const { LEARN_WRITES, runLearnWrite } = await import('./learn-writes');

const TRACK = '11111111-1111-4111-8111-111111111111';
const READING = '22222222-2222-4222-8222-222222222222';
const THEIR_READING = '22222222-2222-4222-8222-222222222223';
const CONCEPT = '33333333-3333-4333-8333-333333333333';
const CARD = '44444444-4444-4444-8444-444444444444';
const VIDEO = 'dQw4w9WgXcQ';
const LINK = 'https://jalammar.github.io/illustrated-transformer/';

const reading = (id: string, user: string, fields: Record<string, unknown> = {}) => ({
  id,
  user_id: user,
  track_id: TRACK,
  title: 'Attention is all you need',
  status: 'queued',
  read_now_at: null,
  note: null,
  given_text: null,
  given_text_label: null,
  given_text_at: null,
  source_id: null,
  open_url: null,
  position: 10,
  ...fields,
});

function seed(): FakeTables {
  return {
    'learn.tracks': [{ id: TRACK, user_id: ME, title: 'Transformers', question: null }],
    'learn.readings': [reading(READING, ME), reading(THEIR_READING, THEM, { position: 20 })],
    'learn.sources': [],
    'learn.next_outcomes': [],
    'learn.concepts': [{ id: CONCEPT, user_id: ME, name: 'Attention' }],
    'learn.feed_cards': [{ id: CARD, user_id: ME, concept_id: CONCEPT }],
    'learn.card_notes': [],
    'learn.watch_list': [{ id: 'w1', user_id: ME, video_id: VIDEO, watched_at: null, verdict: 'watch', item_id: null }],
  };
}

function twins(): [FakeTables, FakeTables] {
  return [seed(), seed()];
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

async function tool(name: string, tables: FakeTables, input: Record<string, unknown>) {
  const learn = fakeSchemaDb(tables)('learn') as unknown as LearnSupabaseClient;
  const made = await runLearnWrite(LEARN_WRITES.find((entry) => entry.name === name)!, { userId: ME, learn }, input);
  if ('ok' in made) throw new Error(made.error);
  return made;
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-03T09:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('change_reading writes what the reading page writes', () => {
  it('marks it read, off the shelf, with the outcome Learn next reads', async () => {
    const [page, dash] = twins();
    for (const tables of [page, dash]) tables['learn.readings'][0].read_now_at = '2026-10-01T00:00:00Z';
    await press(page, () => readingPage.updateStatus({}, form({ readingId: READING, status: 'read' })));
    await tool('change_reading', dash, { reading_id: READING, status: 'read' });
    for (const key of ['learn.readings', 'learn.next_outcomes']) expect(rows(dash, key), key).toEqual(rows(page, key));
    expect(dash['learn.readings'][0]).toMatchObject({ status: 'read', read_now_at: null });
    expect(dash['learn.next_outcomes']).toHaveLength(1);
    expect(dash['learn.readings'][1].status).toBe('queued');
  });

  it('puts it on the shelf, writes the note and keeps the text, as the page does', async () => {
    const [page, dash] = twins();
    await press(page, async () => {
      await readingPage.toggleReadNow({}, form({ readingId: READING, on: 'on' }));
      await readingPage.updateNote({}, form({ readingId: READING, note: '  The key is the scaling.  ' }));
      await readingPage.saveReadingText({}, form({ readingId: READING, text: 'Attention lets every token look at every other.' }));
    });
    await tool('change_reading', dash, {
      reading_id: READING,
      read_now: true,
      note: '  The key is the scaling.  ',
      text: 'Attention lets every token look at every other.',
    });
    expect(rows(dash, 'learn.readings')).toEqual(rows(page, 'learn.readings'));
    expect(dash['learn.readings'][0]).toMatchObject({ note: 'The key is the scaling.', read_now_at: '2026-10-03T09:00:00.000Z' });
  });

  it('clears the kept text as the page does', async () => {
    const [page, dash] = twins();
    for (const tables of [page, dash]) Object.assign(tables['learn.readings'][0], { given_text: 'Old', given_text_label: 'Pasted', given_text_at: 'x' });
    await press(page, () => readingPage.clearReadingText({}, form({ readingId: READING })));
    await tool('change_reading', dash, { reading_id: READING, clear_text: true });
    expect(rows(dash, 'learn.readings')).toEqual(rows(page, 'learn.readings'));
  });

  it('gives it its link and the source behind it, as attaching one does', async () => {
    const [page, dash] = twins();
    const basis = 'Dash attached this link when asked. Nothing has been checked on it yet.';
    const chosen = { title: 'Attention is all you need', kind: 'page', canonical_url: LINK, access: 'unknown', locator_kind: 'whole', locator_basis: basis };
    expect(await press(page, () => readingPage.attachSource({}, form({ readingId: READING, chosen: JSON.stringify(chosen) })))).toEqual({});
    await tool('change_reading', dash, { reading_id: READING, link: LINK });
    for (const key of ['learn.readings', 'learn.sources']) expect(rows(dash, key, ['source_id']), key).toEqual(rows(page, key, ['source_id']));
    expect(dash['learn.readings'][0]).toMatchObject({ open_url: LINK, locator_confidence: 'unverified' });
  });
});

describe('the list and note tools write what their buttons write', () => {
  it('add_learn_track starts the list as Start a track does', async () => {
    const [page, dash] = twins();
    await press(page, () => lists.startTrack({}, form({ title: 'Diffusion models', question: 'How do they denoise?' })));
    await tool('add_learn_track', dash, { title: 'Diffusion models', question: 'How do they denoise?' });
    expect(rows(dash, 'learn.tracks')).toEqual(rows(page, 'learn.tracks'));
  });

  it('add_track_reading adds to the end of the list as Add does, saying it was Dash', async () => {
    const [page, dash] = twins();
    await press(page, () => trackPage.addToTrack({}, form({ trackId: TRACK, title: 'The annotated transformer', why: 'Code alongside' })));
    const made = await tool('add_track_reading', dash, { track_id: TRACK, title: 'The annotated transformer', why: 'Code alongside' });
    expect(rows(dash, 'learn.readings', ['locator_basis'])).toEqual(rows(page, 'learn.readings', ['locator_basis']));
    expect(made.after).toMatchObject({ position: 20, locator_basis: 'Dash added this when asked. Nothing has been looked up for it.' });
  });

  it('add_track_reading keeps a link once, as saving a link does', async () => {
    const [page, dash] = twins();
    for (const tables of [page, dash]) Object.assign(tables['learn.readings'][0], { open_url: LINK });
    const saved = await press(page, () => savePage.saveReadingLink({ status: 'idle' }, form({ url: LINK })));
    expect(saved).toMatchObject({ status: 'saved', readingId: READING, created: false });
    const result = await runLearnWrite(
      LEARN_WRITES.find((entry) => entry.name === 'add_track_reading')!,
      { userId: ME, learn: fakeSchemaDb(dash)('learn') as unknown as LearnSupabaseClient },
      { track_id: TRACK, title: 'The Illustrated Transformer', link: LINK },
    );
    expect(result).toMatchObject({ ok: false });
    expect(dash['learn.readings']).toEqual(page['learn.readings']);
  });

  it('add_concept_note writes the note on an idea and on a card as the pages do', async () => {
    const [page, dash] = twins();
    await press(page, async () => {
      expect(await ideaPage.addConceptNote(CONCEPT, 'Queries meet keys.')).toMatchObject({ note: { body: 'Queries meet keys.' } });
      expect(await nowPage.addCardNote(CARD, 'Softmax over the scores.')).toMatchObject({ note: { body: 'Softmax over the scores.' } });
    });
    await tool('add_concept_note', dash, { concept_id: CONCEPT, body: 'Queries meet keys.' });
    await tool('add_concept_note', dash, { card_id: CARD, body: 'Softmax over the scores.' });
    expect(rows(dash, 'learn.card_notes')).toEqual(rows(page, 'learn.card_notes'));
  });

  it('change_video marks the video watched as the Videos page does', async () => {
    const [page, dash] = twins();
    await press(page, () => videos.setWatchedAction(form({ videoId: VIDEO, watched: '1' })));
    await tool('change_video', dash, { video_id: VIDEO, watched: true });
    expect(rows(dash, 'learn.watch_list')).toEqual(rows(page, 'learn.watch_list'));
    expect(dash['learn.watch_list'][0].watched_at).toBe('2026-10-03T09:00:00.000Z');
  });
});
