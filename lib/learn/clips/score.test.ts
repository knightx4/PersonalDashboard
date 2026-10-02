import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import type { LearnerProfile } from '@/lib/learn/youtube/judge-video';
import { encodeTranscript, storagePathFor } from '@/lib/learn/youtube/transcripts';
import {
  CLIP_LEVELS,
  CLIP_SCORE_QUESTION,
  clipState,
  readHaikuReply,
  scoreClipsFor,
  scoreFromJev,
  scoreFromLevel,
  type ClipToScore,
} from './score-jev';
import { clipWords, fingerprintOf, scoreClips } from './score-run';

/**
 * Scoring clips from 1 to 100 (plan #1401). Jev is a stubbed fetch that
 * answers by caption, or fails when it has no answer for one; Haiku is a
 * stubbed client.
 */

const PROFILE: LearnerProfile = {
  tracks: [{ id: 'subject-1', name: 'Startup Finance', note: null, frontier: ['Cash flow timing'], settled: 3 }],
  goals: [{ id: 'goal-1', title: 'Raise a seed round', detail: null }],
  ideas: [],
};

/** Jev scoring each clip by its caption: [weighted score, confidence]; a 529 for a caption it has no answer for. */
function jevByCaption(byCaption: Record<string, [number, number]>) {
  return vi.fn(async (_url: unknown, init?: RequestInit) => {
    const sent = JSON.parse(String(init?.body)) as { state: { clip: { caption: string } } };
    const answer = byCaption[sent.state.clip.caption];
    if (!answer) return new Response('overloaded', { status: 529 });
    const [score, confidence] = answer;
    return new Response(
      JSON.stringify({
        model: 'jev-1.13.0',
        answers: { answer: { type: 'score', score, confidence, probabilities: {} } },
        usage: { input_tokens: 300, output_tokens: 0 },
      }),
    );
  }) as unknown as typeof fetch;
}

function haikuLevels(scores: { number: number; level: number }[]) {
  const create = vi.fn().mockResolvedValue({
    content: [{ type: 'tool_use', name: 'report_clip_scores', input: { scores } }],
    stop_reason: 'tool_use',
    usage: { input_tokens: 2_000, output_tokens: 60 },
  });
  return { client: { messages: { create } } as unknown as Pick<Anthropic, 'messages'>, create };
}

const clip = (id: string, caption: string): ClipToScore => ({
  id,
  caption,
  idea: `The point of ${caption}.`,
  serves: null,
  title: 'A talk',
  channel: 'A channel',
  transcript: `Words of ${caption}.`,
});

const byId = <T extends { id: string }>(rows: T[]) => [...rows].sort((a, b) => a.id.localeCompare(b.id));

describe('the 1 to 100 scale', () => {
  it('asks ten levels, the most Jev takes', () => {
    expect(CLIP_SCORE_QUESTION.levels).toHaveLength(10);
    expect(CLIP_LEVELS[0]).toMatch(/^1: Serves none/);
    expect(CLIP_LEVELS[9]).toMatch(/^10: Squarely on an active track/);
  });

  it("spreads Jev's weighted score, 0 to 9, over 1 to 100, between levels too", () => {
    expect(scoreFromJev(0)).toBe(1);
    expect(scoreFromJev(9)).toBe(100);
    expect(scoreFromJev(4.5)).toBe(51);
    expect(scoreFromJev(2.3)).toBe(Math.round(1 + (2.3 / 9) * 99));
    expect(scoreFromJev(-1)).toBe(1);
    expect(scoreFromJev(12)).toBe(100);
  });

  it("puts Haiku's level, 1 to 10, on the same scale", () => {
    expect(scoreFromLevel(1)).toBe(1);
    expect(scoreFromLevel(10)).toBe(100);
    expect(scoreFromLevel(6)).toBe(scoreFromJev(5));
  });

  it('keeps only whole levels from 1 to 10 for clips it was given', () => {
    const levels = readHaikuReply(
      { scores: [{ number: 1, level: 7 }, { number: 2, level: 11 }, { number: 3, level: 2.5 }, { number: 9, level: 4 }] },
      3,
    );
    expect([...levels]).toEqual([[1, 7]]);
  });

  it('gives Jev the learner and the clip', () => {
    const state = clipState(PROFILE, clip('a', 'Cash gaps')) as { learner: { tracks: unknown[] }; clip: Record<string, string> };
    expect(state.learner.tracks).toHaveLength(1);
    expect(state.clip).toMatchObject({ caption: 'Cash gaps', point: 'The point of Cash gaps.', transcript: 'Words of Cash gaps.' });
  });
});

describe('scoreClipsFor', () => {
  it("uses every answer Jev gives, sure or not, and asks Haiku nothing", async () => {
    const haiku = haikuLevels([]);
    const spent: string[] = [];
    const result = await scoreClipsFor({
      profile: PROFILE,
      clips: [clip('a', 'Cash gaps'), clip('b', 'A joke')],
      jevEnabled: true,
      client: haiku.client,
      onSpend: (report) => spent.push(report.model),
      jevApiKey: 'k',
      jevFetch: jevByCaption({ 'Cash gaps': [8.1, 0.4], 'A joke': [0.2, 0.95] }),
    });
    expect(byId(result.scores)).toEqual([
      { id: 'a', score: scoreFromJev(8.1), by: 'jev', confidence: 0.4 },
      { id: 'b', score: scoreFromJev(0.2), by: 'jev', confidence: 0.95 },
    ]);
    expect(haiku.create).not.toHaveBeenCalled();
    expect(spent).toEqual(['jev-1.13.0', 'jev-1.13.0']);
  });

  it('sends the clips Jev could not answer to Haiku in one call, on the same scale', async () => {
    const haiku = haikuLevels([
      { number: 1, level: 9 },
      { number: 2, level: 3 },
    ]);
    const spent: string[] = [];
    const result = await scoreClipsFor({
      profile: PROFILE,
      clips: [clip('a', 'Cash gaps'), clip('b', 'Down one'), clip('c', 'Down two')],
      jevEnabled: true,
      client: haiku.client,
      onSpend: (report) => spent.push(report.model),
      jevApiKey: 'k',
      jevFetch: jevByCaption({ 'Cash gaps': [6, 0.7] }),
    });
    expect(haiku.create).toHaveBeenCalledTimes(1);
    const prompt = haiku.create.mock.calls[0][0].messages[0].content as string;
    expect(prompt).toContain('caption: Down one');
    expect(prompt).not.toContain('Cash gaps');
    expect(byId(result.scores)).toEqual([
      { id: 'a', score: scoreFromJev(6), by: 'jev', confidence: 0.7 },
      { id: 'b', score: scoreFromLevel(9), by: 'haiku', confidence: null },
      { id: 'c', score: scoreFromLevel(3), by: 'haiku', confidence: null },
    ]);
    expect(spent).toEqual(['jev-1.13.0', 'claude-haiku-4-5']);
  });

  it('asks Jev nothing for an account that has not opted in', async () => {
    const jevFetch = jevByCaption({ 'Cash gaps': [6, 0.7] });
    const haiku = haikuLevels([{ number: 1, level: 5 }]);
    const result = await scoreClipsFor({
      profile: PROFILE,
      clips: [clip('a', 'Cash gaps')],
      jevEnabled: false,
      client: haiku.client,
      jevApiKey: 'k',
      jevFetch,
    });
    expect(jevFetch).not.toHaveBeenCalled();
    expect(result.scores).toEqual([{ id: 'a', score: scoreFromLevel(5), by: 'haiku', confidence: null }]);
  });

  it('leaves a clip unscored when Haiku fails or is missing, to try again next run', async () => {
    const failing = { messages: { create: vi.fn().mockRejectedValue(new Error('down')) } } as unknown as Pick<Anthropic, 'messages'>;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failed = await scoreClipsFor({ profile: PROFILE, clips: [clip('a', 'X')], jevEnabled: false, client: failing });
    expect(failed).toEqual({ scores: [], unscored: ['a'], failed: 1 });
    const missing = await scoreClipsFor({ profile: PROFILE, clips: [clip('a', 'X')], jevEnabled: false, client: null });
    expect(missing).toEqual({ scores: [], unscored: ['a'], failed: 0 });
    warn.mockRestore();
  });
});

describe('clipWords', () => {
  it('takes the sentences that start inside the clip', () => {
    const sentences = [
      { startSeconds: 10, text: 'Before.' },
      { startSeconds: 21, text: 'First.' },
      { startSeconds: 40, text: 'Last.' },
      { startSeconds: 47, text: 'After.' },
    ];
    expect(clipWords(sentences, 21, 47)).toBe('First. Last.');
    expect(clipWords(sentences, 100, 120)).toBeNull();
  });
});

describe('fingerprintOf', () => {
  it('ignores order and changes when a track or goal is added', () => {
    expect(fingerprintOf(['b', 'a'], ['g'])).toBe(fingerprintOf(['a', 'b'], ['g']));
    expect(fingerprintOf(['a', 'b', 'c'], ['g'])).not.toBe(fingerprintOf(['a', 'b'], ['g']));
    expect(fingerprintOf(['a'], [])).not.toBe(fingerprintOf([], ['a']));
    expect(fingerprintOf(['a'], ['g'])).toHaveLength(32);
  });
});

// ---------------------------------------------------------------------------
// The run, against a small in-memory database

type Row = Record<string, unknown>;

function fakeLearn(tables: Record<string, Row[]>, stored: Record<string, Buffer>) {
  const from = (table: string) => {
    const filters: ((row: Row) => boolean)[] = [];
    let patch: Row | null = null;
    let cap = Infinity;
    const builder = {
      select: () => builder,
      order: () => builder,
      range: () => builder,
      limit: (n: number) => ((cap = n), builder),
      is: (column: string, value: null) => (filters.push((row) => (row[column] ?? null) === value), builder),
      not: (column: string) => (filters.push((row) => (row[column] ?? null) !== null), builder),
      eq: (column: string, value: unknown) => (filters.push((row) => row[column] === value), builder),
      // Postgres: a null never matches neq.
      neq: (column: string, value: unknown) =>
        (filters.push((row) => (row[column] ?? null) !== null && row[column] !== value), builder),
      gt: (column: string, value: number) => (filters.push((row) => (row[column] as number) > value), builder),
      update: (next: Row) => ((patch = next), builder),
      then: (resolve: (value: { data: Row[] | null; error: null }) => void) => {
        const rows = (tables[table] ??= []);
        const hit = rows.filter((row) => filters.every((filter) => filter(row)));
        if (patch) {
          for (const row of hit) Object.assign(row, patch);
          return resolve({ data: null, error: null });
        }
        resolve({ data: hit.slice(0, cap), error: null });
      },
    };
    return builder;
  };
  return {
    from,
    schema: () => ({ from: (table: string) => from(`goals.${table}`) }),
    storage: {
      from: () => ({
        download: async (path: string) => {
          const bytes = stored[path];
          return bytes ? { data: new Blob([new Uint8Array(bytes)]), error: null } : { data: null, error: { message: 'missing' } };
        },
      }),
    },
  } as unknown as LearnSupabaseClient;
}

const USER = 'user-1';
const VIDEO = 'aaaaaaaaaa1';
const NOW = new Date('2026-10-02T12:00:00Z');

function world() {
  const cues = [
    { startSeconds: 0, endSeconds: 20, text: 'Hello and welcome.' },
    { startSeconds: 21, endSeconds: 30, text: 'Profitable firms run out of cash.' },
    { startSeconds: 31, endSeconds: 47, text: 'Because receivables lag.' },
    { startSeconds: 48, endSeconds: 60, text: 'Thanks for watching.' },
  ];
  const clipRow = (id: string, caption: string, extra: Row = {}): Row => ({
    id,
    user_id: USER,
    video_id: VIDEO,
    start_seconds: 21,
    end_seconds: 47,
    caption,
    idea: null,
    serves: null,
    score: null,
    score_by: null,
    score_profile: null,
    shown_at: null,
    not_interested_at: null,
    item: { title: 'A talk', author: 'A channel' },
    ...extra,
  });
  const tables: Record<string, Row[]> = {
    video_clip_cuts: [{ user_id: USER, video_id: VIDEO, clip_count: 3 }],
    subjects: [{ id: 'subject-1', user_id: USER, survey: false }],
    'goals.items': [
      { id: 'goal-1', user_id: USER, level: 'goal', status: 'open', archived_at: null, dismissed_at: null },
    ],
    video_clips: [
      clipRow('new', 'Cash gaps'),
      clipRow('seen', 'Seen before'),
      clipRow('unseen', 'Not yet shown'),
    ],
  };
  const stored = { [storagePathFor(VIDEO)]: encodeTranscript(VIDEO, 'en', cues, NOW) };
  return { tables, learn: fakeLearn(tables, stored) };
}

const ALL_JEV = { 'Cash gaps': [7.2, 0.5], 'Seen before': [3, 0.9], 'Not yet shown': [5, 0.6] } as Record<string, [number, number]>;

describe('scoreClips', () => {
  it('scores every unscored clip with its transcript words, and records who scored it and against what', async () => {
    const { tables, learn } = world();
    const jevFetch = jevByCaption(ALL_JEV);
    const spent: [string, string][] = [];
    const result = await scoreClips(learn, {
      client: haikuLevels([]).client,
      jevEnabled: async () => true,
      deadline: Date.now() + 60_000,
      jevApiKey: 'k',
      jevFetch,
      now: () => NOW,
      onSpend: (userId, report) => spent.push([userId, report.model]),
      profileFor: async () => PROFILE,
    });
    expect(result).toMatchObject({ scored: 3, byJev: 3, byHaiku: 0, rescored: 0, unscored: 0 });
    const fingerprint = fingerprintOf(['subject-1'], ['goal-1']);
    expect(tables.video_clips.find((row) => row.id === 'new')).toMatchObject({
      score: scoreFromJev(7.2),
      score_by: 'jev',
      score_confidence: 0.5,
      scored_at: NOW.toISOString(),
      score_profile: fingerprint,
    });
    const sent = JSON.parse(String((jevFetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body));
    expect(sent.state.clip.transcript).toBe('Profitable firms run out of cash. Because receivables lag.');
    // One spend row per model per person per run.
    expect(spent).toEqual([[USER, 'jev-1.13.0']]);
  });

  it('scores the unseen clips again when a track is added, and leaves the ones already shown', async () => {
    const { tables, learn } = world();
    const options = {
      client: haikuLevels([]).client,
      jevEnabled: async () => true,
      deadline: Date.now() + 60_000,
      jevApiKey: 'k',
      profileFor: async () => PROFILE,
    };
    await scoreClips(learn, { ...options, jevFetch: jevByCaption(ALL_JEV) });
    const seen = tables.video_clips.find((row) => row.id === 'seen')!;
    seen.shown_at = NOW.toISOString();

    // Nothing changed: nothing comes up.
    const quiet = await scoreClips(learn, { ...options, jevFetch: jevByCaption(ALL_JEV) });
    expect(quiet.scored).toBe(0);

    tables.subjects.push({ id: 'subject-2', user_id: USER, survey: false });
    const again = await scoreClips(learn, {
      ...options,
      jevFetch: jevByCaption({ 'Cash gaps': [9, 0.8], 'Seen before': [9, 0.8], 'Not yet shown': [1, 0.8] }),
    });
    expect(again).toMatchObject({ scored: 2, rescored: 2 });
    expect(seen.score).toBe(scoreFromJev(3));
    expect(tables.video_clips.find((row) => row.id === 'unseen')).toMatchObject({
      score: scoreFromJev(1),
      score_profile: fingerprintOf(['subject-1', 'subject-2'], ['goal-1']),
    });
  });

  it('falls back to Haiku for the clips Jev could not answer', async () => {
    const { tables, learn } = world();
    const haiku = haikuLevels([
      { number: 1, level: 10 },
      { number: 2, level: 2 },
    ]);
    const result = await scoreClips(learn, {
      client: haiku.client,
      jevEnabled: async () => true,
      deadline: Date.now() + 60_000,
      jevApiKey: 'k',
      jevFetch: jevByCaption({ 'Cash gaps': [4, 0.3] }),
      profileFor: async () => PROFILE,
    });
    expect(result).toMatchObject({ scored: 3, byJev: 1, byHaiku: 2 });
    expect(haiku.create).toHaveBeenCalledTimes(1);
    expect(tables.video_clips.map((row) => [row.id, row.score, row.score_by, row.score_confidence])).toEqual([
      ['new', scoreFromJev(4), 'jev', 0.3],
      ['seen', 100, 'haiku', null],
      ['unseen', scoreFromLevel(2), 'haiku', null],
    ]);
  });
});
