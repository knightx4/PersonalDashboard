import { describe, expect, it } from 'vitest';
import { loadSubjectFigureNeeds, orderUnbuilt } from './needs-load';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';

const group = (key: string, asked: number, firstAskedAt: string) => ({
  key,
  need: 'model' as const,
  shows: key,
  why: '',
  asked,
  firstAskedAt,
});

describe('orderUnbuilt', () => {
  it('puts the most asked first, then the earliest asked', () => {
    const ordered = orderUnbuilt([group('a', 1, '2026-10-02'), group('b', 3, '2026-10-05'), group('c', 1, '2026-10-01')]);
    expect(ordered.map((g) => g.key)).toEqual(['b', 'c', 'a']);
  });
});

describe('loadSubjectFigureNeeds', () => {
  it('reads the groups that include the subject and drops a need it does not know', async () => {
    const calls: unknown[] = [];
    const rows = [
      { key: 'k1', need: 'data_source', shows: 'x', why: 'y', asked: 2, first_asked_at: '2026-10-01' },
      { key: 'k2', need: 'unheard_of', shows: 'x', why: 'y', asked: 9, first_asked_at: '2026-10-01' },
    ];
    const query = {
      select: () => query,
      eq: (...a: unknown[]) => (calls.push(['eq', ...a]), query),
      contains: (...a: unknown[]) => (calls.push(['contains', ...a]), Promise.resolve({ data: rows, error: null })),
    };
    const learn = { from: () => query } as unknown as LearnSupabaseClient;
    const got = await loadSubjectFigureNeeds(learn, 'u1', 's1');
    expect(got.map((g) => g.key)).toEqual(['k1']);
    expect(calls).toContainEqual(['contains', 'subject_ids', ['s1']]);
  });
});
