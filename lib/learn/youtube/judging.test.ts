import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { jevLine, overrideFor } from './judge-jev-question';
import { readJudgeReply, type LearnerProfile } from './judge-video';
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
    expect(byId.get('bbbbbbbbbbb')).toMatchObject({ verdict: 'skip', judge_verdict: 'skip', verdict_by: 'judge', judged_from: 'title' });
    expect(tables.video_transcripts.some((row) => row.video_id === 'bbbbbbbbbbb')).toBe(false);

    // Let through: screened, reason kept, transcript queued for the list.
    expect(byId.get('aaaaaaaaaaa')).toMatchObject({ verdict: null, screened_at: '2026-09-26T10:00:00.000Z' });
    expect(tables.video_transcripts.find((row) => row.video_id === 'aaaaaaaaaaa')).toMatchObject({ state: 'queued', requested_by: 'list' });

    // Judged from its transcript: a watch verdict with a start and end minute.
    const watched = byId.get('ccccccccccc')!;
    expect(watched).toMatchObject({ verdict: 'watch', judge_verdict: 'watch', verdict_by: 'judge', judged_from: 'transcript', best_start_seconds: 0 });
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

  it('lets Jev screen and judge for an account that opted in, with Haiku only where it is needed', async () => {
    const cues = Array.from({ length: 80 }, (_, index) => ({ startSeconds: index * 10, endSeconds: null, text: `Line ${index}.` }));
    const tables: Record<string, Row[]> = {
      watch_list: [
        listRow('aaaaaaaaaaa', 'Minecraft speedrun'),
        listRow('bbbbbbbbbbb', 'Cash flow in ten minutes'),
        listRow('ccccccccccc', 'Gardening diary', { item: { ...item('Gardening diary'), author: 'Filed channel' } }),
        listRow('ddddddddddd', 'Celebrity gossip roundup', { screened_at: '2026-09-25T00:00:00Z' }),
        listRow('eeeeeeeeeee', 'Building a three-statement model', { screened_at: '2026-09-25T00:00:00Z' }),
        listRow('fffffffffff', 'Budget variance basics', { screened_at: '2026-09-25T00:00:00Z' }),
      ],
      video_transcripts: ['ddddddddddd', 'eeeeeeeeeee', 'fffffffffff'].map((video_id) => ({ video_id, state: 'fetched', attempts: 0 })),
    };
    const stored = Object.fromEntries(
      ['ddddddddddd', 'eeeeeeeeeee', 'fffffffffff'].map((id) => [`youtube/${id}.json.gz`, encodeTranscript(id, 'en', cues, new Date())]),
    );
    // Jev's answer by title; a title it has none for is Jev being down.
    const jevByTitle: Record<string, Record<string, number>> = {
      'Minecraft speedrun': { skip: 0.95, look: 0.05 },
      'Cash flow in ten minutes': { skip: 0.6, look: 0.4 },
      'Celebrity gossip roundup': { skip: 0.92, card: 0.05, watch: 0.03 },
      'Building a three-statement model': { watch: 0.9, card: 0.08, skip: 0.02 },
      'Budget variance basics': { card: 0.5, watch: 0.3, skip: 0.2 },
    };
    const asked: string[] = [];
    const jevFetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const sent = JSON.parse(String(init?.body)) as { state: { video: { title: string } } };
      asked.push(sent.state.video.title);
      const probabilities = jevByTitle[sent.state.video.title];
      if (!probabilities) return new Response('overloaded', { status: 529 });
      const [choice, confidence] = Object.entries(probabilities).sort((x, y) => y[1] - x[1])[0];
      return new Response(
        JSON.stringify({
          model: 'jev-1.13.0',
          answers: { answer: { type: 'choice', choice, confidence, probabilities } },
          usage: { input_tokens: 300, output_tokens: 0 },
        }),
      );
    }) as unknown as typeof fetch;

    const systems: string[] = [];
    const create = vi.fn().mockImplementation(async (request: { system: string; tools: { name: string }[]; messages: { content: string }[] }) => {
      const tool = request.tools[0].name;
      systems.push(request.system);
      if (tool === 'report_screen') {
        return toolReply(tool, { videos: [{ number: 1, decision: 'look', why: 'Serves your "Startup Finance / FP&A" track.' }] });
      }
      // Haiku says card even where Jev settled a watch: the settled verdict wins.
      return toolReply(tool, {
        verdict: 'card',
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
      profileFor: async () => ({
        ...profile,
        // Filed against the judge: Jev never settles a video from this channel.
        filed: [{ title: 'An old garden tour', channel: 'Filed channel', judge: 'skip', you: 'watch' }],
      }),
      onSpend: spend,
      jevEnabled: async () => true,
      jevApiKey: 'jev-key',
      jevFetch,
      now: () => new Date('2026-09-26T10:00:00Z'),
    });

    expect(result).toMatchObject({ skipped: 1, passed: 2, judged: 3, failed: 0 });
    const byId = new Map(tables.watch_list.map((row) => [row.video_id, row]));

    // Jev sure of a skip: skipped from the title, with its line as the reason.
    expect(byId.get('aaaaaaaaaaa')).toMatchObject({ verdict: 'skip', judged_from: 'title', why: 'Skipped from its title and description, 95% sure.' });
    // Jev unsure: let through with no Haiku call, since the screen looks when in doubt.
    expect(byId.get('bbbbbbbbbbb')).toMatchObject({ verdict: null, why: null, screened_at: '2026-09-26T10:00:00.000Z' });
    // Your filing's channel: Jev is not asked, Haiku screens it.
    expect(asked).not.toContain('Gardening diary');
    expect(byId.get('ccccccccccc')).toMatchObject({ verdict: null, why: 'Serves your "Startup Finance / FP&A" track.' });

    // Second pass: a sure skip settled by Jev alone.
    expect(byId.get('ddddddddddd')).toMatchObject({
      verdict: 'skip',
      judge_verdict: 'skip',
      judged_from: 'transcript',
      why: 'Judged not worth your time, 92% sure.',
      stretches: [],
    });
    // A sure watch: Haiku names the stretch and writes the reason; the verdict stays Jev's.
    expect(byId.get('eeeeeeeeeee')).toMatchObject({
      verdict: 'watch',
      judge_verdict: 'watch',
      why: 'Serves your "Startup Finance / FP&A" track: builds the model live.',
      best_start_seconds: 0,
    });
    // Unsure: Haiku judges it as before.
    expect(byId.get('fffffffffff')).toMatchObject({ verdict: 'card', judge_verdict: 'card' });

    // Haiku: one screen for the filed channel's video, one settled watch, one full judgement.
    expect(create).toHaveBeenCalledTimes(3);
    expect(systems.filter((system) => system.includes('THE VERDICT IS SETTLED: WATCH'))).toHaveLength(1);

    // Jev's screening spend is one row for the batch.
    const jevSpend = spend.mock.calls.filter((call) => call[2].model === 'jev-1.13.0');
    expect(jevSpend.filter((call) => call[1] === 'screen')).toHaveLength(1);
    expect(jevSpend.find((call) => call[1] === 'screen')![2].usage.inputTokens).toBe(600);
    expect(jevSpend.filter((call) => call[1] === 'judge')).toHaveLength(3);
  });

  it('asks nothing of Jev for an account that has not opted in', async () => {
    const tables: Record<string, Row[]> = { watch_list: [listRow('aaaaaaaaaaa', 'Minecraft speedrun')], video_transcripts: [] };
    const jevFetch = vi.fn() as unknown as typeof fetch;
    const create = vi.fn().mockResolvedValue(toolReply('report_screen', { videos: [{ number: 1, decision: 'skip', why: 'Touches none of them.' }] }));

    await judgeWatchLists(fakeLearn(tables, {}), {
      anthropicApiKey: 'k',
      deadline: Date.now() + 60_000,
      client: { messages: { create } } as unknown as Anthropic,
      profileFor: async () => profile,
      jevEnabled: async () => false,
      jevApiKey: 'jev-key',
      jevFetch,
    });

    expect(jevFetch).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledTimes(1);
    expect(tables.watch_list[0]).toMatchObject({ verdict: 'skip', why: 'Touches none of them.' });
  });
});

describe('overrideFor', () => {
  const filed = [
    { title: 'Agreed already', channel: 'Agreed channel', judge: 'watch' as const, you: 'watch' as const },
    { title: 'Discounted cash flow walkthrough', channel: 'Finance channel', judge: 'skip' as const, you: 'card' as const },
  ];

  it('matches a video from a channel you filed against the judge', () => {
    expect(overrideFor({ title: 'Anything at all', channel: 'finance CHANNEL ' }, filed)).toBe(filed[1]);
  });

  it('matches a video on the same topic from another channel', () => {
    expect(overrideFor({ title: 'Cash flow statements, discounted', channel: 'Elsewhere' }, filed)).toBe(filed[1]);
  });

  it('ignores a filing where you agreed with the judge, and a single shared word', () => {
    expect(overrideFor({ title: 'Something new', channel: 'Agreed channel' }, filed)).toBeNull();
    expect(overrideFor({ title: 'Cash for beginners', channel: 'Elsewhere' }, filed)).toBeNull();
  });
});

describe('the Jev path on the judge', () => {
  const windows = [
    { startSeconds: 0, endSeconds: 270, text: 'One.' },
    { startSeconds: 240, endSeconds: 510, text: 'Two.' },
  ];

  it('keeps a settled card with Jev\'s line as its reason, whatever Haiku answered', () => {
    const line = jevLine('judge', { choice: 'card', confidence: 0.88 });
    expect(line).toBe('Judged worth a few cards rather than a watch, 88% sure.');
    const judged = readJudgeReply({ verdict: 'skip', windows: [{ window: 2, point: 'A point.' }] }, windows, 510, { verdict: 'card', line });
    expect(judged).toMatchObject({ outcome: 'judged', verdict: 'card', why: line, stretches: [{ startSeconds: 240, point: 'A point.' }] });
  });

  it('still refuses an unsettled verdict with no reason', () => {
    expect(readJudgeReply({ verdict: 'skip', why: '' }, windows, 510)).toMatchObject({ outcome: 'failed' });
  });
});
