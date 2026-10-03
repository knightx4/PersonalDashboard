import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { cutClips } from './clip-run';
import { cutPrompt, cutVideo, matchServes, readCutReply, sentencesFromCues } from './clips';
import { CLIP_TRANSCRIPT } from './fixtures/clip-transcript';
import type { LearnerProfile } from './judge-video';
import { encodeTranscript, storagePathFor } from './transcripts';

/**
 * Cutting clips (plan #1398), on a stored transcript with an intro, a sponsor
 * read, two points that stand alone, one that does not, and a sign-off. The
 * model is a stub that answers with the clips a good cut would name plus the
 * ones the reply checks have to throw out.
 */

const PROFILE: LearnerProfile = {
  tracks: [{ id: 'subject-1', name: 'Startup Finance', note: null, frontier: ['Cash flow timing'], settled: 3 }],
  goals: [{ id: 'goal-1', title: 'Raise a seed round', detail: null }],
  ideas: [],
};

const REPLY = {
  clips: [
    { start: 21, end: 47, caption: 'Why profitable firms still run out of cash', idea: 'Working capital gaps need funding.', serves: 'Startup Finance', stands_alone: true },
    { start: 65, end: 92, caption: 'The cash conversion cycle in one sum', idea: 'Inventory plus receivables minus payables days.', serves: 'Goal: "Raise a seed round"', stands_alone: true },
    { start: 97, end: 102, caption: 'Back to the earlier gap', idea: 'Refers back.', serves: '', stands_alone: false },
    { start: 0, end: 106, caption: 'The whole video', idea: 'Everything.', serves: '', stands_alone: true },
    { start: 34, end: 47, caption: 'Profit is not cash', idea: 'Overlaps the first.', serves: 'Startup Finance', stands_alone: true },
    { start: 500, end: 520, caption: 'Past the end', idea: 'No such sentence.', serves: '', stands_alone: true },
    { start: 74, end: 83, caption: '   ', idea: 'No caption.', serves: '', stands_alone: true },
  ],
};

function stubClient(reply: unknown = REPLY): { client: Anthropic; create: ReturnType<typeof vi.fn> } {
  const create = vi.fn(async () => ({
    content: [{ type: 'tool_use', name: 'report_clips', input: reply }],
    usage: { input_tokens: 2000, output_tokens: 400 },
    stop_reason: 'tool_use',
  }));
  return { client: { messages: { create } } as unknown as Anthropic, create };
}

describe('sentencesFromCues', () => {
  it('joins caption fragments into sentences labelled by their start', () => {
    const sentences = sentencesFromCues(CLIP_TRANSCRIPT);
    expect(sentences).toHaveLength(14);
    expect(sentences[1]).toMatchObject({ startSeconds: 3.2, endSeconds: 16.4 });
    expect(sentences[1].text).toContain('sponsored by LedgerPro');
    expect(sentences[3]).toMatchObject({ startSeconds: 21, endSeconds: 34.4 });
    expect(sentences[13].text).toBe("That's it for today. If this helped, hit subscribe and I'll see you in the next one.");
  });

  it('closes a sentence with no punctuation after fifteen seconds', () => {
    const cues = Array.from({ length: 10 }, (_, index) => ({ startSeconds: index * 4, endSeconds: index * 4 + 4, text: 'and so on' }));
    const sentences = sentencesFromCues(cues);
    expect(sentences.map((sentence) => sentence.startSeconds)).toEqual([0, 16, 32]);
  });
});

describe('cutPrompt', () => {
  it('numbers each sentence by its second and carries the profile', () => {
    const prompt = cutPrompt(PROFILE, { title: 'Working capital', channel: 'A channel', durationSeconds: 114, sentences: sentencesFromCues(CLIP_TRANSCRIPT) });
    expect(prompt).toContain('[21] Working capital is the cash');
    expect(prompt).toContain('[65] Now, the cash conversion cycle');
    expect(prompt).toContain('Track "Startup Finance"');
    expect(prompt).toContain('Goal "Raise a seed round"');
  });
});

describe('readCutReply', () => {
  it('keeps the clips that stand alone, on sentence boundaries, at most ninety seconds, and none overlapping', () => {
    const clips = readCutReply(REPLY, sentencesFromCues(CLIP_TRANSCRIPT), PROFILE);
    expect(clips).toEqual([
      {
        startSeconds: 21,
        endSeconds: 61,
        caption: 'Why profitable firms still run out of cash',
        idea: 'Working capital gaps need funding.',
        serves: 'Startup Finance',
        subjectId: 'subject-1',
        goalId: null,
      },
      {
        startSeconds: 65,
        endSeconds: 98,
        caption: 'The cash conversion cycle in one sum',
        idea: 'Inventory plus receivables minus payables days.',
        serves: 'Goal: "Raise a seed round"',
        subjectId: null,
        goalId: 'goal-1',
      },
    ]);
  });

  it('refuses a malformed reply and reads an empty one as no clips', () => {
    expect(readCutReply({ clips: 'none' }, [], PROFILE)).toBeNull();
    expect(readCutReply({ clips: [] }, [], PROFILE)).toEqual([]);
  });

  it('keeps what a clip serves only when it names a track or goal, and takes em dashes out of captions', () => {
    const sentences = sentencesFromCues(CLIP_TRANSCRIPT);
    const clips = readCutReply(
      { clips: [{ start: 21, end: 47, caption: 'Profit is not cash—timing is', idea: 'Gaps.', serves: 'Working capital', stands_alone: true }] },
      sentences,
      PROFILE,
    );
    expect(clips?.[0]).toMatchObject({ caption: 'Profit is not cash, timing is', serves: null, subjectId: null, goalId: null });
  });

  it('matches what a clip serves by name only', () => {
    expect(matchServes('startup finance', PROFILE)).toEqual({ subjectId: 'subject-1', goalId: null });
    expect(matchServes('Cooking', PROFILE)).toEqual({ subjectId: null, goalId: null });
    expect(matchServes(null, PROFILE)).toEqual({ subjectId: null, goalId: null });
  });
});

describe('cutVideo', () => {
  const video = { title: 'Working capital', channel: null, durationSeconds: 114, sentences: sentencesFromCues(CLIP_TRANSCRIPT) };

  it('makes one Haiku call and reports what it cost', async () => {
    const { client, create } = stubClient();
    const onSpend = vi.fn();
    const result = await cutVideo({ profile: PROFILE, video, anthropicApiKey: 'k', client, onSpend });
    expect(result.outcome === 'cut' && result.clips.map((clip) => clip.startSeconds)).toEqual([21, 65]);
    expect(create).toHaveBeenCalledTimes(1);
    expect(onSpend).toHaveBeenCalledWith(expect.objectContaining({ model: 'claude-haiku-4-5' }));
  });

  it('tells a failed call from an unreadable reply', async () => {
    const throwing = { messages: { create: vi.fn(async () => Promise.reject(new Error('overloaded'))) } } as unknown as Anthropic;
    expect(await cutVideo({ profile: PROFILE, video, anthropicApiKey: 'k', client: throwing })).toEqual({ outcome: 'failed', detail: 'overloaded' });
    const prose = {
      messages: { create: vi.fn(async () => ({ content: [{ type: 'text', text: 'Here are clips' }], usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: 'end_turn' })) },
    } as unknown as Anthropic;
    expect((await cutVideo({ profile: PROFILE, video, anthropicApiKey: 'k', client: prose })).outcome).toBe('unreadable');
  });
});

// ---------------------------------------------------------------------------
// The run, over tables held in memory
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

const CONFLICT: Record<string, string[]> = {
  video_clips: ['user_id', 'video_id', 'start_seconds'],
  video_clip_cuts: ['user_id', 'video_id'],
};

function fakeLearn(tables: Record<string, Row[]>, stored: Record<string, Buffer>) {
  const from = (table: string) => {
    const filters: ((row: Row) => boolean)[] = [];
    let upserting: Row[] | null = null;
    let range: [number, number] | null = null;
    const builder = {
      select: () => builder,
      order: () => builder,
      range: (start: number, end: number) => ((range = [start, end]), builder),
      is: (column: string, value: null) => (filters.push((row) => (row[column] ?? null) === value), builder),
      not: (column: string) => (filters.push((row) => (row[column] ?? null) !== null), builder),
      eq: (column: string, value: unknown) => (filters.push((row) => row[column] === value), builder),
      in: (column: string, list: unknown[]) => (filters.push((row) => list.includes(row[column])), builder),
      upsert: (next: Row | Row[]) => ((upserting = Array.isArray(next) ? next : [next]), builder),
      then: (resolve: (value: { data: Row[] | null; error: null }) => void) => {
        const rows = (tables[table] ??= []);
        if (upserting) {
          for (const next of upserting) {
            const at = rows.findIndex((row) => CONFLICT[table].every((column) => row[column] === next[column]));
            if (at === -1) rows.push({ ...next });
            else Object.assign(rows[at], next);
          }
          return resolve({ data: null, error: null });
        }
        const hit = rows.filter((row) => filters.every((filter) => filter(row)));
        resolve({ data: range ? hit.slice(range[0], range[1] + 1) : hit, error: null });
      },
    };
    return builder;
  };
  return {
    from,
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

const OWNER = 'owner-1';
const NOW = new Date('2026-10-02T12:00:00Z');
// Real-shaped eleven-character ids.
const LISTED = 'aaaaaaaaaa1';
const LISTED_OLDER = 'aaaaaaaaaa2';
const CHANNEL_NEW = 'cccccccccc1';
const CHANNEL_OLD = 'cccccccccc2';
const NOT_FETCHED = 'dddddddddd1';
const DONE = 'eeeeeeeeee1';

function world() {
  const transcript = (id: string) => encodeTranscript(id, 'en', CLIP_TRANSCRIPT, NOW);
  const fetchedIds = [LISTED, LISTED_OLDER, CHANNEL_NEW, CHANNEL_OLD, DONE];
  const item = (id: string, title: string) => ({ id: `item-${id}`, title, author: 'A channel', duration_seconds: 114 });
  const tables: Record<string, Row[]> = {
    video_transcripts: [...fetchedIds.map((video_id) => ({ video_id, state: 'fetched' })), { video_id: NOT_FETCHED, state: 'queued' }],
    watch_list: [
      { user_id: OWNER, video_id: LISTED, item_id: `item-${LISTED}`, left_playlist_at: null, item: item(LISTED, 'Listed') },
      { user_id: OWNER, video_id: LISTED_OLDER, item_id: `item-${LISTED_OLDER}`, left_playlist_at: null, item: item(LISTED_OLDER, 'Older') },
      { user_id: OWNER, video_id: NOT_FETCHED, item_id: `item-${NOT_FETCHED}`, left_playlist_at: null, item: item(NOT_FETCHED, 'Waiting') },
    ],
    catalogue_providers: [
      { id: 'prov-ted', name: 'TED', youtube_channel_id: 'UC1' },
      { id: 'prov-list', name: 'Your YouTube list', youtube_channel_id: null },
    ],
    catalogue_items: [
      { id: 'item-c1', kind: 'video', external_id: CHANNEL_NEW, provider_id: 'prov-ted', title: 'New talk', author: null, duration_seconds: 114, published_at: '2026-09-01' },
      { id: 'item-c2', kind: 'video', external_id: CHANNEL_OLD, provider_id: 'prov-ted', title: 'Old talk', author: null, duration_seconds: 114, published_at: '2020-01-01' },
      // On your list as well: cut once, as playlist.
      { id: 'item-dup', kind: 'video', external_id: LISTED, provider_id: 'prov-ted', title: 'Listed', author: null, duration_seconds: 114, published_at: '2026-09-30' },
      { id: 'item-own', kind: 'video', external_id: LISTED_OLDER, provider_id: 'prov-list', title: 'Older', author: null, duration_seconds: 114, published_at: null },
    ],
    video_clip_cuts: [{ user_id: OWNER, video_id: DONE, clip_count: 2 }],
    video_clips: [],
  };
  const stored = Object.fromEntries(fetchedIds.map((id) => [storagePathFor(id), transcript(id)]));
  return { tables, learn: fakeLearn(tables, stored) };
}

describe('cutClips', () => {
  it('cuts your list first, then followed channels newest first, and skips what is cut or not transcribed', async () => {
    const { tables, learn } = world();
    const { client, create } = stubClient();
    const spend = vi.fn();
    const result = await cutClips(learn, {
      anthropicApiKey: 'k',
      owner: OWNER,
      deadline: Date.now() + 60_000,
      limit: 3,
      client,
      onSpend: spend,
      now: () => NOW,
      profileFor: async () => PROFILE,
    });

    expect(result).toEqual({ cut: 3, clips: 6, failed: 0, unreadable: 0, waiting: 1, stopped: null });
    expect(create).toHaveBeenCalledTimes(3);
    expect(spend).toHaveBeenCalledTimes(3);
    expect(spend.mock.calls.every(([userId]) => userId === OWNER)).toBe(true);
    const cuts = tables.video_clip_cuts.filter((row) => row.video_id !== DONE);
    expect(cuts.map((row) => [row.video_id, row.came_from, row.clip_count])).toEqual([
      [LISTED, 'playlist', 2],
      [LISTED_OLDER, 'playlist', 2],
      [CHANNEL_NEW, 'channel', 2],
    ]);
    const first = tables.video_clips.find((row) => row.video_id === CHANNEL_NEW && row.start_seconds === 21);
    expect(first).toMatchObject({ user_id: OWNER, item_id: 'item-c1', came_from: 'channel', end_seconds: 61, subject_id: 'subject-1' });
    expect(first).not.toHaveProperty('score');
  });

  it('records a video that gave no clips, and leaves a failed call for the next run', async () => {
    const { tables, learn } = world();
    const { client } = stubClient({ clips: [] });
    await cutClips(learn, { anthropicApiKey: 'k', owner: OWNER, deadline: Date.now() + 60_000, limit: 1, client, now: () => NOW, profileFor: async () => PROFILE });
    expect(tables.video_clip_cuts.find((row) => row.video_id === LISTED)).toMatchObject({ clip_count: 0, error: null });

    const failing = { messages: { create: vi.fn(async () => Promise.reject(new Error('timeout'))) } } as unknown as Anthropic;
    const result = await cutClips(learn, { anthropicApiKey: 'k', owner: OWNER, deadline: Date.now() + 60_000, limit: 1, client: failing, now: () => NOW, profileFor: async () => PROFILE });
    expect(result.failed).toBe(1);
    expect(tables.video_clip_cuts.some((row) => row.video_id === LISTED_OLDER)).toBe(false);
  });

  it('starts nothing once the deadline has passed', async () => {
    const { learn } = world();
    const { client, create } = stubClient();
    const result = await cutClips(learn, { anthropicApiKey: 'k', owner: OWNER, deadline: Date.now() - 1, client, profileFor: async () => PROFILE });
    expect(create).not.toHaveBeenCalled();
    expect(result.stopped).toMatch(/out of time/);
    expect(result.waiting).toBe(4);
  });
});
