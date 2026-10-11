import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { tagUntaggedClips } from './clip-tag-run';
import { readTagReply, tagClipBatch, tagPrompt, TAG_BATCH, type ClipToTag, type SubjectToTag } from './clip-tags';

/**
 * Tagging the clips already cut (plan #1696). The model is a stub that
 * answers by clip number; the tables are held in memory.
 */

const SUBJECTS: SubjectToTag[] = [
  { id: 'subject-1', name: 'Startup Finance / FP&A', note: 'runway and burn' },
  { id: 'subject-2', name: 'SaaS and subscription business metrics', note: null },
];

const CLIPS: ClipToTag[] = [
  { id: 'clip-a', caption: 'Why profitable firms still run out of cash', idea: 'Working capital gaps need funding.' },
  { id: 'clip-b', caption: 'Net revenue retention, explained', idea: null },
  { id: 'clip-c', caption: 'A morning routine', idea: 'Wake up early.' },
];

describe('tagPrompt', () => {
  it('lists the subjects with their notes and numbers each clip by caption and point', () => {
    const prompt = tagPrompt(SUBJECTS, CLIPS);
    expect(prompt).toContain('- Startup Finance / FP&A (runway and burn)');
    expect(prompt).toContain('- SaaS and subscription business metrics');
    expect(prompt).toContain('[1] Why profitable firms still run out of cash. Point: Working capital gaps need funding.');
    expect(prompt).toContain('[2] Net revenue retention, explained');
    expect(prompt).not.toContain('Point: null');
  });
});

describe('readTagReply', () => {
  it('maps names back to subjects by number, ignores names not on the list, and leaves out-of-range numbers alone', () => {
    const read = readTagReply(
      {
        clips: [
          { clip: 1, subjects: ['Startup Finance / FP&A', 'saas and subscription business metrics', 'Cooking'] },
          { clip: 2, subjects: 'SaaS and subscription business metrics' },
          { clip: 9, subjects: ['Startup Finance / FP&A'] },
        ],
      },
      CLIPS,
      SUBJECTS,
    );
    expect(read && Object.fromEntries(read)).toEqual({
      'clip-a': ['subject-1', 'subject-2'],
      'clip-b': ['subject-2'],
      'clip-c': [],
    });
  });

  it('is null for a reply that is not the tool shape', () => {
    expect(readTagReply({ clips: 'none' }, CLIPS, SUBJECTS)).toBeNull();
  });
});

const REPLY = {
  clips: [
    { clip: 1, subjects: ['Startup Finance / FP&A'] },
    { clip: 2, subjects: ['SaaS and subscription business metrics', 'Startup Finance / FP&A'] },
    { clip: 3, subjects: [] },
  ],
};

function stubClient(reply: unknown = REPLY): { client: Anthropic; create: ReturnType<typeof vi.fn> } {
  const create = vi.fn(async () => ({
    content: [{ type: 'tool_use', name: 'report_clip_subjects', input: reply }],
    usage: { input_tokens: 1500, output_tokens: 300 },
    stop_reason: 'tool_use',
  }));
  return { client: { messages: { create } } as unknown as Anthropic, create };
}

describe('tagClipBatch', () => {
  it('makes one Haiku call and reports what it cost', async () => {
    const { client, create } = stubClient();
    const onSpend = vi.fn();
    const result = await tagClipBatch({ subjects: SUBJECTS, clips: CLIPS, anthropicApiKey: 'k', client, onSpend });
    expect(result.outcome === 'tagged' && result.subjects.get('clip-b')).toEqual(['subject-2', 'subject-1']);
    expect(create).toHaveBeenCalledTimes(1);
    expect(onSpend).toHaveBeenCalledWith(expect.objectContaining({ model: 'claude-haiku-5-5' }));
  });

  it('reports a failed call and a prose reply as failed', async () => {
    const throwing = { messages: { create: vi.fn(async () => Promise.reject(new Error('overloaded'))) } } as unknown as Anthropic;
    expect(await tagClipBatch({ subjects: SUBJECTS, clips: CLIPS, anthropicApiKey: 'k', client: throwing })).toEqual({
      outcome: 'failed',
      detail: 'overloaded',
    });
    const prose = {
      messages: { create: vi.fn(async () => ({ content: [{ type: 'text', text: 'All finance' }], usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: 'end_turn' })) },
    } as unknown as Anthropic;
    expect((await tagClipBatch({ subjects: SUBJECTS, clips: CLIPS, anthropicApiKey: 'k', client: prose })).outcome).toBe('failed');
  });
});

// ---------------------------------------------------------------------------
// The pass, over tables held in memory
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

function fakeLearn(tables: Record<string, Row[]>) {
  const from = (table: string) => {
    const filters: ((row: Row) => boolean)[] = [];
    let upserting: Row[] | null = null;
    let updating: Row | null = null;
    let range: [number, number] | null = null;
    const builder = {
      select: () => builder,
      order: () => builder,
      range: (start: number, end: number) => ((range = [start, end]), builder),
      is: (column: string, value: null) => (filters.push((row) => (row[column] ?? null) === value), builder),
      eq: (column: string, value: unknown) => (filters.push((row) => row[column] === value), builder),
      in: (column: string, list: unknown[]) => (filters.push((row) => list.includes(row[column])), builder),
      upsert: (next: Row[]) => ((upserting = next), builder),
      update: (patch: Row) => ((updating = patch), builder),
      then: (resolve: (value: { data: Row[] | null; error: null }) => void) => {
        const rows = (tables[table] ??= []);
        if (upserting) {
          // ignoreDuplicates: only the rows inserted come back.
          const inserted: Row[] = [];
          for (const next of upserting) {
            if (rows.some((row) => row.clip_id === next.clip_id && row.subject_id === next.subject_id)) continue;
            const row = { id: `${table}-${rows.length + 1}`, ...next };
            rows.push(row);
            inserted.push(row);
          }
          return resolve({ data: inserted, error: null });
        }
        const hit = rows.filter((row) => filters.every((filter) => filter(row)));
        if (updating) {
          for (const row of hit) Object.assign(row, updating);
          return resolve({ data: null, error: null });
        }
        resolve({ data: range ? hit.slice(range[0], range[1] + 1) : hit, error: null });
      },
    };
    return builder;
  };
  return { from } as unknown as LearnSupabaseClient;
}

const OWNER = 'owner-1';
const NOW = new Date('2026-10-08T12:00:00Z');

function world() {
  const tables: Record<string, Row[]> = {
    video_clips: [
      ...CLIPS.map((clip) => ({ id: clip.id, user_id: OWNER, caption: clip.caption, idea: clip.idea, tagged_at: null })),
      // Cut after #1695: tagged at the cut, never read again.
      { id: 'clip-new', user_id: OWNER, caption: 'Burn multiple', idea: null, tagged_at: '2026-10-08T00:00:00Z' },
    ],
    // Carried over from video_clips.subject_id by migration 0097.
    video_clip_subjects: [{ id: 'kept', user_id: OWNER, clip_id: 'clip-a', subject_id: 'subject-1' }],
  };
  return { tables, learn: fakeLearn(tables) };
}

const run = (learn: LearnSupabaseClient, client: Anthropic, extra: Partial<Parameters<typeof tagUntaggedClips>[1]> = {}) =>
  tagUntaggedClips(learn, {
    anthropicApiKey: 'k',
    deadline: Date.now() + 60_000,
    client,
    now: () => NOW,
    subjectsFor: async () => SUBJECTS,
    ...extra,
  });

describe('tagUntaggedClips', () => {
  it('tags each unchecked clip with every subject it fits, marks all of them checked, and reports both counts', async () => {
    const { tables, learn } = world();
    const { client, create } = stubClient();
    const spend = vi.fn();
    const result = await run(learn, client, { onSpend: spend });

    expect(result).toEqual({ checked: 3, tagged: 2, fitNothing: 1, tags: 2, failed: 0, waiting: 0, stopped: null });
    expect(create).toHaveBeenCalledTimes(1);
    expect(spend).toHaveBeenCalledWith(OWNER, expect.objectContaining({ model: 'claude-haiku-5-5' }));
    expect(tables.video_clip_subjects.map((row) => [row.clip_id, row.subject_id])).toEqual([
      ['clip-a', 'subject-1'],
      ['clip-b', 'subject-2'],
      ['clip-b', 'subject-1'],
    ]);
    expect(tables.video_clips.filter((row) => row.id !== 'clip-new').every((row) => row.tagged_at === NOW.toISOString())).toBe(true);
    expect(tables.video_clips.find((row) => row.id === 'clip-new')!.tagged_at).toBe('2026-10-08T00:00:00Z');
  });

  it('reads nothing and tags nothing new on a second run', async () => {
    const { tables, learn } = world();
    await run(learn, stubClient().client);
    const before = tables.video_clip_subjects.length;
    const { client, create } = stubClient();
    const again = await run(learn, client);
    expect(again).toEqual({ checked: 0, tagged: 0, fitNothing: 0, tags: 0, failed: 0, waiting: 0, stopped: null });
    expect(create).not.toHaveBeenCalled();
    expect(tables.video_clip_subjects).toHaveLength(before);
  });

  it('leaves a failed batch unchecked for the next run, and skips a person with no subjects', async () => {
    const { tables, learn } = world();
    const failing = { messages: { create: vi.fn(async () => Promise.reject(new Error('timeout'))) } } as unknown as Anthropic;
    expect(await run(learn, failing)).toMatchObject({ checked: 0, failed: 1, waiting: 3 });
    expect(tables.video_clips.filter((row) => row.tagged_at === null)).toHaveLength(3);

    const { client, create } = stubClient();
    expect(await run(learn, client, { subjectsFor: async () => [] })).toMatchObject({ checked: 0, waiting: 3 });
    expect(create).not.toHaveBeenCalled();
  });

  it('sends batches of fifty and stops at the batch cap', async () => {
    const tables: Record<string, Row[]> = {
      video_clips: Array.from({ length: TAG_BATCH * 2 + 5 }, (_, i) => ({ id: `c${i}`, user_id: OWNER, caption: `Clip ${i}`, idea: null, tagged_at: null })),
      video_clip_subjects: [],
    };
    const { client, create } = stubClient({ clips: [] });
    const result = await run(fakeLearn(tables), client, { maxBatches: 2 });
    expect(create).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ checked: TAG_BATCH * 2, tagged: 0, fitNothing: TAG_BATCH * 2, waiting: 5 });
  });
});
