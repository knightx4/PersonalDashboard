import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import type { LearnerProfile } from './judge-video';
import { judgeWatchLists } from './judging';
import { encodeTranscript } from './transcripts';

/**
 * One run of the judge over a list held in memory (plan #1066).
 *
 * The fake answers the handful of PostgREST filters the judge and the
 * transcript queue use, over plain rows, so what is checked is what reaches
 * the table: which rows got a verdict, which transcripts were asked for, and
 * that a verdict you set is left alone.
 */

type Row = Record<string, unknown>;

function fakeLearn(tables: Record<string, Row[]>, stored: Record<string, Buffer>) {
  const matches = (row: Row, filters: ((row: Row) => boolean)[]) => filters.every((filter) => filter(row));
  const from = (table: string) => {
    const filters: ((row: Row) => boolean)[] = [];
    let op: 'select' | 'update' | 'insert' = 'select';
    let values: Row | Row[] = {};
    const builder = {
      select: () => builder,
      order: () => builder,
      limit: () => builder,
      is: (column: string, value: null) => (filters.push((row) => (row[column] ?? null) === value), builder),
      not: (column: string) => (filters.push((row) => (row[column] ?? null) !== null), builder),
      eq: (column: string, value: unknown) => (filters.push((row) => row[column] === value), builder),
      in: (column: string, list: unknown[]) => (filters.push((row) => list.includes(row[column])), builder),
      or: (spec: string) => {
        const parts = spec.split(',').map((part) => part.split('.'));
        filters.push((row) =>
          parts.some(([column, operator, value]) =>
            operator === 'is' ? (row[column] ?? null) === null : operator === 'neq' ? row[column] !== value : row[column] === value,
          ),
        );
        return builder;
      },
      update: (next: Row) => ((op = 'update'), (values = next), builder),
      insert: (next: Row[]) => ((op = 'insert'), (values = next), builder),
      then: (resolve: (value: { data: Row[] | null; error: null }) => void) => {
        const rows = (tables[table] ??= []);
        if (op === 'insert') {
          rows.push(...(values as Row[]).map((row) => ({ attempts: 0, ...row })));
          return resolve({ data: null, error: null });
        }
        const hit = rows.filter((row) => matches(row, filters));
        if (op === 'update') for (const row of hit) Object.assign(row, values);
        resolve({ data: hit, error: null });
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

const USER = 'user-1';
const item = (title: string, duration = 600, description = 'About it.') => ({
  title,
  author: 'A channel',
  description,
  duration_seconds: duration,
  provider: { name: 'Your YouTube list' },
});
const listRow = (videoId: string, title: string, extra: Row = {}): Row => ({
  user_id: USER,
  video_id: videoId,
  left_playlist_at: null,
  verdict: null,
  verdict_by: null,
  screened_at: null,
  summary: null,
  key_points: null,
  item: item(title),
  ...extra,
});

const profile: LearnerProfile = {
  tracks: [{ name: 'Startup Finance / FP&A', note: null, frontier: [], settled: 2 }],
  goals: [],
  ideas: [],
};

function toolReply(name: string, input: unknown) {
  return { content: [{ type: 'tool_use', name, input }], stop_reason: 'tool_use', usage: { input_tokens: 500, output_tokens: 80 } };
}

describe('judgeWatchLists', () => {
  it('skips from the title without a transcript, asks for the rest, and judges what has arrived', async () => {
    const cues = Array.from({ length: 80 }, (_, index) => ({ startSeconds: index * 10, endSeconds: null, text: `Line ${index}.` }));
    const tables: Record<string, Row[]> = {
      watch_list: [
        listRow('aaaaaaaaaaa', 'Cash flow in ten minutes'),
        listRow('bbbbbbbbbbb', 'Minecraft speedrun'),
        // Screened on an earlier run, and its transcript is now stored.
        listRow('ccccccccccc', 'Building a three-statement model', { screened_at: '2026-09-25T00:00:00Z' }),
        // Moved by hand (#1068): never read, never written.
        listRow('ddddddddddd', 'Something you wanted', { verdict: 'watch', verdict_by: 'you', why: 'Mine.' }),
        // Over two hours: judged from its chapters, no transcript asked for.
        listRow('eeeeeeeeeee', 'A long lecture', { screened_at: '2026-09-25T00:00:00Z', item: item('A long lecture', 9000, '0:00 Intro\n10:00 Budgets\n50:00 Forecasts') }),
      ],
      video_transcripts: [{ video_id: 'ccccccccccc', state: 'fetched', attempts: 0 }],
    };
    const stored = { 'youtube/ccccccccccc.json.gz': encodeTranscript('ccccccccccc', 'en', cues, new Date()) };

    const create = vi.fn().mockImplementation(async (request: { tools: { name: string }[]; messages: { content: string }[] }) => {
      const tool = request.tools[0].name;
      if (tool === 'report_screen') {
        return toolReply(tool, {
          videos: [
            { number: 1, decision: 'look', why: 'Serves your "Startup Finance / FP&A" track.' },
            { number: 2, decision: 'skip', why: 'Touches none of your tracks, goals or ideas; a game run.' },
          ],
        });
      }
      if (request.messages[0].content.includes('A long lecture')) {
        return toolReply(tool, { verdict: 'card', why: 'Serves your "Startup Finance / FP&A" track: forecasting.', windows: [{ window: 3, point: 'Forecasts roll forward.' }] });
      }
      return toolReply(tool, {
        verdict: 'watch',
        why: 'Serves your "Startup Finance / FP&A" track: builds the model live.',
        best_from: 1,
        best_to: 2,
        windows: [{ window: 1, point: 'Sets up the sheet.' }],
      });
    });
    const spend = vi.fn();

    const result = await judgeWatchLists(fakeLearn(tables, stored), {
      anthropicApiKey: 'k',
      deadline: Date.now() + 60_000,
      client: { messages: { create } } as unknown as Anthropic,
      profileFor: async () => profile,
      onSpend: spend,
      now: () => new Date('2026-09-26T10:00:00Z'),
    });

    expect(result).toMatchObject({ skipped: 1, passed: 1, queued: 1, judged: 2, failed: 0, stopped: null });
    const byId = new Map(tables.watch_list.map((row) => [row.video_id, row]));

    // The clear skip: a verdict from the title, and no transcript asked for.
    expect(byId.get('bbbbbbbbbbb')).toMatchObject({ verdict: 'skip', verdict_by: 'judge', judged_from: 'title' });
    expect(tables.video_transcripts.some((row) => row.video_id === 'bbbbbbbbbbb')).toBe(false);

    // Let through: screened, reason kept, transcript queued for the list.
    expect(byId.get('aaaaaaaaaaa')).toMatchObject({ verdict: null, screened_at: '2026-09-26T10:00:00.000Z' });
    expect(tables.video_transcripts.find((row) => row.video_id === 'aaaaaaaaaaa')).toMatchObject({ state: 'queued', requested_by: 'list' });

    // Judged from its transcript: a watch verdict with a start and end minute.
    const watched = byId.get('ccccccccccc')!;
    expect(watched).toMatchObject({ verdict: 'watch', verdict_by: 'judge', judged_from: 'transcript', best_start_seconds: 0 });
    expect(watched.best_end_seconds as number).toBeGreaterThan(0);
    expect(watched.stretches).toEqual([{ startSeconds: 0, endSeconds: expect.any(Number), point: 'Sets up the sheet.' }]);

    // The long lecture, from its chapters.
    expect(byId.get('eeeeeeeeeee')).toMatchObject({
      verdict: 'card',
      judged_from: 'chapters',
      stretches: [{ startSeconds: 3000, endSeconds: 9000, point: 'Forecasts roll forward.' }],
    });
    expect(tables.video_transcripts.some((row) => row.video_id === 'eeeeeeeeeee')).toBe(false);

    // Yours, untouched.
    expect(byId.get('ddddddddddd')).toMatchObject({ verdict: 'watch', verdict_by: 'you', why: 'Mine.' });

    // One screening call for the batch and one call per judged video, each on its pass.
    expect(create).toHaveBeenCalledTimes(3);
    expect(spend.mock.calls.map((call) => call[1]).sort()).toEqual(['judge', 'judge', 'screen']);
  });

  it('does not overwrite a verdict you set while the run was working', async () => {
    const row = listRow('aaaaaaaaaaa', 'Cash flow in ten minutes');
    const tables: Record<string, Row[]> = { watch_list: [row], video_transcripts: [] };
    const create = vi.fn().mockImplementation(async () => {
      // The move lands between the read and the write.
      Object.assign(row, { verdict: 'watch', verdict_by: 'you' });
      return toolReply('report_screen', { videos: [{ number: 1, decision: 'skip', why: 'Touches none of them.' }] });
    });

    await judgeWatchLists(fakeLearn(tables, {}), {
      anthropicApiKey: 'k',
      deadline: Date.now() + 60_000,
      client: { messages: { create } } as unknown as Anthropic,
      profileFor: async () => profile,
    });

    expect(row).toMatchObject({ verdict: 'watch', verdict_by: 'you' });
  });
});
