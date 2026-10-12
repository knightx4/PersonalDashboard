import { describe, expect, it } from 'vitest';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { loadNextClips } from './next';

/**
 * The subject filter on loadNextClips (plan #1697). The fake client answers
 * each read from a list of clips, applying the filters the loader sends,
 * including the one on the embedded join table, so a test sees what a
 * subject's player would be handed.
 */

const USER = '00000000-0000-4000-8000-0000000000aa';
const SUBJECT_A = '00000000-0000-4000-8000-00000000000a';
const SUBJECT_B = '00000000-0000-4000-8000-00000000000b';
const SUBJECT_EMPTY = '00000000-0000-4000-8000-00000000000e';
const NOW = Date.parse('2026-10-08T12:00:00Z');
const LONG_AGO = '2026-08-01T12:00:00Z';

type FakeClip = Record<string, unknown> & { id: string; tags: string[] };

function clip(id: string, video: string, cameFrom: 'playlist' | 'channel', tags: string[], extra: Record<string, unknown> = {}): FakeClip {
  return {
    id,
    user_id: USER,
    video_id: video,
    item_id: null,
    came_from: cameFrom,
    start_seconds: 10,
    end_seconds: 70,
    caption: `Clip ${id}`,
    idea: null,
    serves: null,
    // The first match only, deliberately wrong for clip a3: the loader must not read it.
    subject_id: tags[0] ?? null,
    goal_id: null,
    score: 0.8,
    rating: null,
    shown_at: null,
    skipped_at: null,
    not_interested_at: null,
    saved_at: null,
    item: null,
    tags,
    ...extra,
  };
}

const CLIPS: FakeClip[] = [
  clip('a1', 'v1', 'playlist', [SUBJECT_A]),
  clip('a2', 'v2', 'channel', [SUBJECT_A]),
  // Serves both; its subject_id names B, the first match.
  clip('a3', 'v3', 'channel', [SUBJECT_B, SUBJECT_A]),
  // Skipped long ago, so it may come back.
  clip('a4', 'v4', 'playlist', [SUBJECT_A], { shown_at: LONG_AGO, skipped_at: LONG_AGO }),
  clip('b1', 'v5', 'playlist', [SUBJECT_B]),
  clip('b2', 'v6', 'channel', [SUBJECT_B]),
  clip('n1', 'v7', 'channel', []),
];

type Filter = { op: string; column: string; value: unknown };
type Read = { table: string; select: string; filters: Filter[] };

function matches(row: FakeClip, filter: Filter): boolean {
  if (filter.column === 'video_clip_subjects.subject_id') return row.tags.includes(String(filter.value));
  const value = row[filter.column];
  switch (filter.op) {
    case 'eq':
      return value === filter.value;
    case 'is':
      return value === filter.value;
    case 'not':
      return value !== null && value !== undefined;
    case 'lt':
      return typeof value === 'string' && value < String(filter.value);
    case 'gte':
      return typeof value === 'string' && value >= String(filter.value);
    case 'in':
      return (filter.value as unknown[]).includes(value);
    default:
      return true;
  }
}

function fakeClient(rows: FakeClip[]) {
  const reads: Read[] = [];
  const client = {
    from(table: string) {
      const read: Read = { table, select: '', filters: [] };
      reads.push(read);
      const builder = {
        select(columns: string) {
          read.select = columns;
          return builder;
        },
        eq(column: string, value: unknown) {
          read.filters.push({ op: 'eq', column, value });
          return builder;
        },
        is(column: string, value: unknown) {
          read.filters.push({ op: 'is', column, value });
          return builder;
        },
        not(column: string) {
          read.filters.push({ op: 'not', column, value: null });
          return builder;
        },
        lt(column: string, value: unknown) {
          read.filters.push({ op: 'lt', column, value });
          return builder;
        },
        gte(column: string, value: unknown) {
          read.filters.push({ op: 'gte', column, value });
          return builder;
        },
        in(column: string, value: unknown) {
          read.filters.push({ op: 'in', column, value });
          return builder;
        },
        or() {
          read.filters.push({ op: 'or', column: '', value: null });
          return builder;
        },
        order() {
          return builder;
        },
        limit() {
          return builder;
        },
        then(resolve: (result: { data: unknown[]; error: null }) => unknown) {
          // Only the candidate reads select the caption; the rest (reactions,
          // the week, cards, the last shown) answer with nothing.
          const data =
            table === 'video_clips' && read.select.includes('caption')
              ? rows.filter((row) => read.filters.every((filter) => matches(row, filter)))
              : [];
          return Promise.resolve({ data, error: null }).then(resolve);
        },
      };
      return builder;
    },
  };
  return { learn: client as unknown as LearnSupabaseClient, reads };
}

describe('loadNextClips for one subject', () => {
  it('plays only the clips tagged to the subject, from playlists and channels alike', async () => {
    const { learn } = fakeClient(CLIPS);
    const clips = await loadNextClips(learn, USER, { subjectId: SUBJECT_A, limit: 10, now: NOW });
    const ids = clips.map((c) => c.id).sort();
    expect(ids).toEqual(['a1', 'a2', 'a3', 'a4']);
  });

  it('never hands over another subject’s clip', async () => {
    const { learn } = fakeClient(CLIPS);
    const clips = await loadNextClips(learn, USER, { subjectId: SUBJECT_B, limit: 10, now: NOW });
    expect(clips.map((c) => c.id).sort()).toEqual(['a3', 'b1', 'b2']);
  });

  it('returns nothing for a subject no clip serves', async () => {
    const { learn } = fakeClient(CLIPS);
    expect(await loadNextClips(learn, USER, { subjectId: SUBJECT_EMPTY, limit: 10, now: NOW })).toEqual([]);
  });

  it('narrows every candidate read through the join table, not video_clips.subject_id', async () => {
    const { learn, reads } = fakeClient(CLIPS);
    await loadNextClips(learn, USER, { subjectId: SUBJECT_A, now: NOW });
    const candidates = reads.filter((read) => read.table === 'video_clips' && read.select.includes('caption'));
    expect(candidates).toHaveLength(5);
    for (const read of candidates) {
      expect(read.select).toContain('video_clip_subjects!inner(subject_id)');
      expect(read.filters).toContainEqual({ op: 'eq', column: 'video_clip_subjects.subject_id', value: SUBJECT_A });
      expect(read.filters.some((filter) => filter.column === 'subject_id')).toBe(false);
    }
  });

  it('reads every clip when no subject is given', async () => {
    const { learn, reads } = fakeClient(CLIPS);
    const clips = await loadNextClips(learn, USER, { limit: 10, now: NOW });
    expect(clips.map((c) => c.id)).toContain('n1');
    expect(reads.some((read) => read.select.includes('video_clip_subjects'))).toBe(false);
  });
});
