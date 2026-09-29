import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import type { YouTubeVideo } from '@/lib/learn/providers/youtube';
import type { LearnerProfile } from './judge-video';
import type { TranscribeResult } from './transcripts';

/**
 * Judging found channels on three of their videos (plan #1196). The database
 * is held in memory, YouTube and the transcript fetch are fixtures, and the
 * model is a fake that answers by tool name, so what is checked is what
 * reaches subject_channels and the transcript queue.
 */

vi.mock('@/lib/learn/graph/load', () => ({
  loadGraph: vi.fn(async () => ({ concepts: [], edges: [], mentions: [] })),
}));

// Keeping the good samples (#1197) has its own test; here it only has to be
// handed each newly judged sample once, on the press and on the scheduled run.
const keepGoodSamples = vi.fn(async (_learn: unknown, input: { subjectId: string; samples: { verdict: string }[] }) =>
  input.samples.filter((sample) => sample.verdict !== 'skip').length,
);
vi.mock('./keep-samples', () => ({ keepGoodSamples }));

const { encodeTranscript } = await import('./transcripts');
const { judgeFoundChannels, pickCandidates, readPickReply, readVerdictReply, uploadsPlaylistFor, verdictPrompt, MAX_CREDITS_PER_SUBJECT } =
  await import('./channel-judge');
const { rootingFor } = await import('@/lib/learn/graph/rooting');

type Row = Record<string, unknown>;

function fakeLearn(tables: Record<string, Row[]>, stored: Record<string, Buffer>) {
  const from = (table: string) => {
    const filters: ((row: Row) => boolean)[] = [];
    let op: 'select' | 'update' | 'insert' = 'select';
    let values: Row | Row[] = {};
    let single = false;
    const run = () => {
      const rows = (tables[table] ??= []);
      if (op === 'insert') {
        rows.push(...(values as Row[]).map((row) => ({ attempts: 0, ...row })));
        return { data: null, error: null };
      }
      const hit = rows.filter((row) => filters.every((filter) => filter(row)));
      if (op === 'update') for (const row of hit) Object.assign(row, values);
      return { data: single ? (hit[0] ?? null) : hit, error: null };
    };
    const builder = {
      select: () => builder,
      order: () => builder,
      limit: () => builder,
      is: (column: string, value: null) => (filters.push((row) => (row[column] ?? null) === value), builder),
      eq: (column: string, value: unknown) => (filters.push((row) => row[column] === value), builder),
      in: (column: string, list: unknown[]) => (filters.push((row) => list.includes(row[column])), builder),
      update: (next: Row) => ((op = 'update'), (values = next), builder),
      insert: (next: Row[]) => ((op = 'insert'), (values = next), builder),
      maybeSingle: async () => ((single = true), run()),
      then: (resolve: (value: unknown) => void) => resolve(run()),
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

const USER = 'user-1';
const SUBJECT = 'subject-1';
const CHANNEL_A = `UC${'a'.repeat(22)}`;
const CHANNEL_B = `UC${'b'.repeat(22)}`;

const profile: LearnerProfile = {
  tracks: [{ name: 'Linear algebra', note: null, frontier: ['Eigenvectors'], settled: 4 }],
  goals: [],
  ideas: [],
};

function video(id: string, title: string, durationSeconds: number | null = 900): YouTubeVideo {
  return {
    videoId: id,
    title,
    description: '',
    canonicalUrl: `https://www.youtube.com/watch?v=${id}`,
    durationSeconds,
    publishedAt: null,
    channelId: null,
    channelTitle: null,
  };
}

const vid = (channel: 'a' | 'b', n: number) => `${channel}${String(n).padStart(10, '0')}`;

const uploadsByPlaylist: Record<string, YouTubeVideo[]> = {
  [uploadsPlaylistFor(CHANNEL_A)]: [
    video(vid('a', 1), 'Eigenvectors, visually'),
    video(vid('a', 2), 'A short', 40),
    video(vid('a', 3), 'Change of basis'),
    video(vid('a', 4), 'Channel update'),
    video(vid('a', 5), 'Determinants'),
  ],
  [uploadsPlaylistFor(CHANNEL_B)]: [video(vid('b', 1), 'Matrices 1'), video(vid('b', 2), 'Matrices 2'), video(vid('b', 3), 'Matrices 3')],
};

const uploads = {
  playlist: vi.fn(async (playlistId: string) => ({
    ok: true as const,
    videoIds: (uploadsByPlaylist[playlistId] ?? []).map((v) => v.videoId),
    addedAt: {},
    complete: true,
  })),
  videos: vi.fn(async (ids: string[]) => ({
    ok: true as const,
    videos: Object.values(uploadsByPlaylist)
      .flat()
      .filter((v) => ids.includes(v.videoId)),
  })),
};

const cues = Array.from({ length: 60 }, (_, index) => ({ startSeconds: index * 10, endSeconds: null, text: `Line ${index}.` }));

/** Fetches the first `limit` videos it is asked for, as transcribeVideos would. */
function fakeTranscribe(tables: Record<string, Row[]>, stored: Record<string, Buffer>, limit: number) {
  return vi.fn(async (_learn: LearnSupabaseClient, ids: string[], options: { maxCredits: number }): Promise<TranscribeResult> => {
    let credits = 0;
    for (const id of ids) {
      if (credits >= Math.min(limit, options.maxCredits)) break;
      const row = tables.video_transcripts.find((r) => r.video_id === id)!;
      row.state = 'fetched';
      stored[`youtube/${id}.json.gz`] = encodeTranscript(id, 'en', cues, new Date());
      credits += 1;
    }
    return { fetched: credits, none: 0, failed: 0, cached: 0, credits, segments: 0, stopped: null };
  });
}

function toolReply(name: string, input: unknown) {
  return { content: [{ type: 'tool_use', name, input }], stop_reason: 'tool_use', usage: { input_tokens: 400, output_tokens: 60 } };
}

function fakeModel() {
  const create = vi.fn(async (request: { tools: { name: string }[]; messages: { content: string }[] }) => {
    const tool = request.tools[0].name;
    if (tool === 'report_picks') return toolReply(tool, { numbers: [1, 2, 3, 1] });
    if (tool === 'report_verdict') return toolReply(tool, { verdict: 'card', why: 'Serves your "Linear algebra" track.', windows: [{ window: 1, point: 'A point.' }] });
    return toolReply(tool, { verdict: 'follow', why: 'Starts from eigenvectors, which is where you are.' });
  });
  return { client: { messages: { create } } as unknown as Anthropic, create };
}

function channelRow(id: string, youtubeChannelId: string, title: string): Row {
  return { id, user_id: USER, subject_id: SUBJECT, youtube_channel_id: youtubeChannelId, title, found_why: 'Recommended.', verdict: null, why: null, judged_at: null, picks: null, samples: [] };
}

describe('the pure parts', () => {
  it('names the uploads playlist after the channel', () => {
    expect(uploadsPlaylistFor(CHANNEL_A)).toBe(`UU${'a'.repeat(22)}`);
  });

  it('leaves out Shorts and keeps three picks at most, without repeats', () => {
    const videos = pickCandidates(uploadsByPlaylist[uploadsPlaylistFor(CHANNEL_A)]);
    expect(videos.map((v) => v.title)).not.toContain('A short');
    const picks = readPickReply({ numbers: [2, 2, 9, 1, 3, 4] }, videos);
    expect(picks?.map((p) => p.title)).toEqual(['Change of basis', 'Eigenvectors, visually', 'Channel update']);
    expect(readPickReply({ numbers: 'no' }, videos)).toBeNull();
  });

  it('refuses a verdict with no reason', () => {
    expect(readVerdictReply({ verdict: 'pass', why: '  ' })).toBeNull();
    expect(readVerdictReply({ verdict: 'maybe', why: 'x' })).toBeNull();
    expect(readVerdictReply({ verdict: 'follow', why: 'Fits.' })).toEqual({ verdict: 'follow', why: 'Fits.' });
  });

  it('puts where the person is in the subject in the verdict prompt', () => {
    const prompt = verdictPrompt({
      subject: 'Linear algebra',
      note: null,
      rooting: rootingFor({ concepts: [], edges: [], mentions: [] } as never, null),
      channel: 'Channel A',
      foundWhy: 'Recommended on a forum.',
      samples: [],
    });
    expect(prompt).toContain('Learn has no record yet of what they know');
    expect(prompt).toContain('CHANNEL: Channel A');
  });
});

describe('judgeFoundChannels', () => {
  it('picks, fetches what fits, judges the channels whose three are in and leaves the rest queued', async () => {
    const tables: Record<string, Row[]> = {
      subjects: [{ id: SUBJECT, user_id: USER, name: 'Linear algebra', note: null }],
      subject_channels: [channelRow('ch-a', CHANNEL_A, 'Channel A'), channelRow('ch-b', CHANNEL_B, 'Channel B')],
      video_transcripts: [],
    };
    const stored: Record<string, Buffer> = {};
    // Four credits: all three of A's picks and one of B's.
    const transcribe = fakeTranscribe(tables, stored, 4);
    const { client, create } = fakeModel();
    const spent: string[] = [];

    const result = await judgeFoundChannels({
      learn: fakeLearn(tables, stored),
      userId: USER,
      subjectId: SUBJECT,
      trigger: 'press',
      maxCredits: 900,
      client,
      profile,
      uploads,
      transcribe,
      onSpend: (pass) => spent.push(pass),
    });

    expect(result).toMatchObject({ ok: true, picked: 2, sampled: 4, kept: 4, waiting: 1, failed: 0, quotaUnits: 4 });
    expect(keepGoodSamples.mock.calls.map(([, input]) => [input.subjectId, input.samples.length])).toEqual([
      [SUBJECT, 3],
      [SUBJECT, 1],
    ]);
    expect(transcribe.mock.calls[0][2]).toMatchObject({ trigger: 'press', maxCredits: MAX_CREDITS_PER_SUBJECT });
    // Every pick was asked for under the new requested_by, whether fetched or not.
    expect(tables.video_transcripts).toHaveLength(6);
    expect(tables.video_transcripts.every((row) => row.requested_by === 'channel')).toBe(true);

    const [a, b] = tables.subject_channels;
    expect((a.picks as { title: string }[]).map((p) => p.title)).toEqual(['Eigenvectors, visually', 'Change of basis', 'Channel update']);
    expect(a).toMatchObject({ verdict: 'follow', why: 'Starts from eigenvectors, which is where you are.' });
    expect(a.judged_at).toEqual(expect.any(String));
    expect(a.samples).toHaveLength(3);
    expect((a.samples as Row[])[0]).toMatchObject({ verdict: 'card', line: 'Serves your "Linear algebra" track.', judged_from: 'transcript' });

    expect(b.verdict).toBeNull();
    expect(b.samples).toHaveLength(1);
    expect(spent.filter((pass) => pass === 'pick')).toHaveLength(2);
    expect(spent.filter((pass) => pass === 'sample')).toHaveLength(4);
    expect(spent.filter((pass) => pass === 'verdict')).toHaveLength(1);

    // The scheduled run fetches B's other two; the next pass spends nothing
    // itself, judges them and gives B its verdict without picking again.
    for (const row of tables.video_transcripts.filter((r) => r.state !== 'fetched')) {
      row.state = 'fetched';
      stored[`youtube/${row.video_id as string}.json.gz`] = encodeTranscript(row.video_id as string, 'en', cues, new Date());
    }
    create.mockClear();
    uploads.playlist.mockClear();
    keepGoodSamples.mockClear();
    const later = await judgeFoundChannels({
      learn: fakeLearn(tables, stored),
      userId: USER,
      subjectId: SUBJECT,
      trigger: 'scheduled',
      maxCredits: 0,
      client,
      profile,
      uploads,
      transcribe,
    });
    expect(later).toMatchObject({ ok: true, picked: 0, sampled: 2, kept: 2, waiting: 0, transcripts: null });
    // Only B's two new samples are kept; its first was kept by the press.
    expect(keepGoodSamples).toHaveBeenCalledTimes(1);
    expect(keepGoodSamples.mock.calls[0][1].samples).toHaveLength(2);
    expect(uploads.playlist).not.toHaveBeenCalled();
    expect(transcribe).toHaveBeenCalledTimes(1);
    expect(tables.subject_channels[1]).toMatchObject({ verdict: 'follow' });
    expect(tables.subject_channels[1].samples).toHaveLength(3);
  });

  it('passes a channel with nothing on the subject, and refuses a subject that is not yours', async () => {
    const empty = `UC${'c'.repeat(22)}`;
    const tables: Record<string, Row[]> = {
      subjects: [{ id: SUBJECT, user_id: USER, name: 'Linear algebra', note: null }],
      subject_channels: [channelRow('ch-c', empty, 'Channel C')],
      video_transcripts: [],
    };
    const { client, create } = fakeModel();
    const result = await judgeFoundChannels({
      learn: fakeLearn(tables, {}),
      userId: USER,
      subjectId: SUBJECT,
      trigger: 'press',
      maxCredits: 10,
      client,
      profile,
      uploads,
      transcribe: fakeTranscribe(tables, {}, 10),
    });
    expect(result).toMatchObject({ ok: true, judged: [{ id: 'ch-c', verdict: 'pass' }] });
    expect(tables.subject_channels[0]).toMatchObject({ verdict: 'pass', picks: [] });
    expect(create).not.toHaveBeenCalled();

    const other = await judgeFoundChannels({
      learn: fakeLearn(tables, {}),
      userId: 'someone-else',
      subjectId: SUBJECT,
      trigger: 'press',
      maxCredits: 10,
      client,
      profile,
      uploads,
    });
    expect(other).toMatchObject({ ok: false, reason: 'no-subject' });
  });
});
