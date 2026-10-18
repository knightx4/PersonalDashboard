import { describe, expect, it, vi } from 'vitest';
import type { YouSupabaseClient } from '@/lib/you/db/schema-name';
import {
  insightFromRow,
  layersOf,
  listInsights,
  receiptsOf,
  runFromRow,
  safeLink,
  saveVerdict,
  verdictOf,
} from './insights';

const row = (over: Record<string, unknown> = {}) => ({
  id: 'i1',
  run_id: 'r1',
  kind: 'pattern',
  claim: 'You move cities when a job stops teaching you.',
  layers: [
    { depth: 'deeper', text: 'Each move came within a year of a role going flat.' },
    { depth: 'saw', text: 'You have lived in four cities since 2018.' },
    { depth: 'further', text: 'Learning is what you are loyal to, not the place.' },
  ],
  receipts: [{ source: 'you.places', row_id: 'p1', quote: 'Moved in 2021-03', link: '/you/places/p1' }],
  confidence: 'medium',
  live_ref: null,
  status: 'shown',
  superseded_by: null,
  created_at: '2026-10-18T10:00:00Z',
  insight_verdicts: [],
  ...over,
});

describe('insightFromRow', () => {
  it('reads a well-formed row, with its layers in depth order', () => {
    const insight = insightFromRow(row());
    expect(insight?.layers.map((l) => l.depth)).toEqual(['saw', 'deeper', 'further']);
    expect(insight?.receipts).toEqual([
      { source: 'you.places', rowId: 'p1', quote: 'Moved in 2021-03', link: '/you/places/p1' },
    ]);
    expect(insight?.verdict).toBeNull();
    expect(insight?.confidence).toBe('medium');
  });

  it('leaves out a row with no claim', () => {
    expect(insightFromRow(row({ claim: '   ' }))).toBeNull();
    expect(insightFromRow(row({ id: null }))).toBeNull();
  });

  it('survives jsonb of the wrong shape', () => {
    const insight = insightFromRow(row({ layers: { depth: 'saw' }, receipts: 'none', confidence: 'sure', status: 'x' }));
    expect(insight?.layers).toEqual([]);
    expect(insight?.receipts).toEqual([]);
    expect(insight?.confidence).toBe('hunch');
    expect(insight?.status).toBe('retired');
  });

  it('reads the verdict embedded as a list or as one object', () => {
    const mark = { verdict: 'not_quite', note: ' close ', decided_at: '2026-10-18T11:00:00Z' };
    expect(insightFromRow(row({ insight_verdicts: [mark] }))?.verdict).toEqual({
      verdict: 'not_quite',
      note: 'close',
      decidedAt: '2026-10-18T11:00:00Z',
    });
    expect(verdictOf(mark)?.verdict).toBe('not_quite');
    expect(verdictOf({ verdict: 'maybe' })).toBeNull();
    expect(verdictOf(null)).toBeNull();
  });
});

describe('layersOf and receiptsOf', () => {
  it('drops a layer of an unknown depth or with no text, and keeps the order within a depth', () => {
    expect(
      layersOf([
        { depth: 'deeper', text: 'b' },
        { depth: 'deepest', text: 'x' },
        { depth: 'saw', text: '' },
        { depth: 'deeper', text: 'c' },
        'loose',
        null,
      ]),
    ).toEqual([
      { depth: 'deeper', text: 'b' },
      { depth: 'deeper', text: 'c' },
    ]);
  });

  it('keeps a receipt that names a source, with a number as its quote and an unsafe link dropped', () => {
    expect(
      receiptsOf([
        { source: 'Me/Journal.md', quote: 'I keep leaving.', link: 'javascript:alert(1)' },
        { source: 'you.work_history', row_id: 7, number: 3 },
        { row_id: 'no source' },
      ]),
    ).toEqual([
      { source: 'Me/Journal.md', rowId: null, quote: 'I keep leaving.', link: null },
      { source: 'you.work_history', rowId: '7', quote: '3', link: null },
    ]);
  });
});

describe('safeLink', () => {
  it('takes an app path or a web page and nothing else', () => {
    expect(safeLink('/vault/notes/abc')).toBe('/vault/notes/abc');
    expect(safeLink('https://example.com/a')).toBe('https://example.com/a');
    expect(safeLink('//evil.example')).toBeNull();
    expect(safeLink('javascript:alert(1)')).toBeNull();
    expect(safeLink(3)).toBeNull();
  });
});

describe('runFromRow', () => {
  it('reads an unknown status as failed', () => {
    expect(runFromRow({ id: 'r1', status: 'thinking', requested_at: 'now' }).status).toBe('failed');
    expect(runFromRow({ id: 'r1', status: 'ready', summary: 'Read 40 notes.' }).summary).toBe('Read 40 notes.');
  });
});

describe('the store', () => {
  it('reads only the named account and the shown insights by default', async () => {
    const calls: unknown[][] = [];
    const chain = {
      select: (...a: unknown[]) => (calls.push(['select', ...a]), chain),
      eq: (...a: unknown[]) => (calls.push(['eq', ...a]), chain),
      in: (...a: unknown[]) => (calls.push(['in', ...a]), chain),
      order: () => Promise.resolve({ data: [row(), row({ id: 'i2', claim: '' })], error: null }),
    };
    const client = { from: vi.fn(() => chain) } as unknown as YouSupabaseClient;
    const insights = await listInsights(client, 'user-1');
    expect(insights.map((i) => i.id)).toEqual(['i1']);
    expect(calls).toContainEqual(['eq', 'user_id', 'user-1']);
    expect(calls).toContainEqual(['in', 'status', ['shown']]);
  });

  it('saves a verdict as an upsert on the insight, refusing an unknown one', async () => {
    const upsert = vi.fn(() => ({
      select: () => ({
        single: () => Promise.resolve({ data: { verdict: 'wrong', note: null, decided_at: 'd' }, error: null }),
      }),
    }));
    const client = { from: vi.fn(() => ({ upsert })) } as unknown as YouSupabaseClient;
    expect(await saveVerdict(client, 'user-1', 'i1', 'wrong', '  ')).toEqual({ verdict: 'wrong', note: null, decidedAt: 'd' });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'user-1', insight_id: 'i1', verdict: 'wrong', note: null }),
      { onConflict: 'insight_id' },
    );
    await expect(saveVerdict(client, 'user-1', 'i1', 'meh' as never)).rejects.toThrow('Unknown verdict');
  });
});
