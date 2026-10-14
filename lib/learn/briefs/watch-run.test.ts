import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/server', () => ({ after: () => undefined }));
vi.mock('@/lib/learn/spend', () => ({
  collectSpend: () => {
    const reports: unknown[] = [];
    return { reports, sink: (r: unknown) => reports.push(r) };
  },
  recordLearnSpend: async () => undefined,
}));
vi.mock('@/inngest/learn/feed-top-up', () => ({ writeCardsForBrief: async () => null }));
vi.mock('@/lib/learn/tracks/save', () => ({ createTrack: async () => 'track-new' }));

const { checkBrief } = await import('./watch-run');
import type { Brief } from './model';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';

const NOW = Date.parse('2026-10-14T06:00:00Z');

/** A learn client holding one list of readings, recording the inserts and the brief's update. */
function fakeLearn(existing: { id: string; open_url: string; position: number }[]) {
  const inserted: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];
  const chain = (result: () => unknown) => {
    const self: Record<string, unknown> = {};
    for (const name of ['select', 'eq', 'or', 'is', 'order']) self[name] = () => self;
    self.then = (resolve: (v: unknown) => unknown) => resolve(result());
    return self;
  };
  const learn = {
    from(table: string) {
      return {
        select: () => chain(() => ({ data: existing, error: null })),
        insert: (rows: Record<string, unknown>[]) => {
          inserted.push(...rows);
          return chain(() => ({
            data: rows.map((r, i) => ({ id: `new-${i}`, open_url: r.open_url })),
            error: null,
          }));
        },
        update: (columns: Record<string, unknown>) => {
          updates.push({ table, ...columns });
          return chain(() => ({ error: null }));
        },
      };
    },
  };
  return { learn: learn as unknown as LearnSupabaseClient, inserted, updates };
}

function fakeClient(text: string, results: { url: string; title: string; page_age?: string }[]) {
  return {
    messages: {
      create: vi.fn(async () => ({
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
        content: [
          {
            type: 'web_search_tool_result',
            content: results.map((r) => ({ type: 'web_search_result', ...r })),
          },
          { type: 'text', text },
        ],
      })),
    },
  };
}

const brief: Brief & { userId: string } = {
  id: 'brief-1',
  userId: 'user-1',
  trackId: 'track-1',
  question: 'How do SOX controls apply to AI?',
  angle: '',
  depth: 'standard',
  subQuestions: [],
  status: 'ready',
  stage: null,
  error: null,
  sections: [],
  shortAnswer: 'Tested like other IT general controls.',
  shortAnswerBy: 'dash',
  watchOn: true,
  watchedAt: '2026-10-01T00:00:00Z',
  quietChecks: 2,
  archivedAt: null,
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
};

describe('one weekly check of a brief', () => {
  it('adds a new source with its change line, skips one already listed, and records the spend', async () => {
    const { learn, inserted, updates } = fakeLearn([{ id: 'r1', open_url: 'https://pcaobus.org/old', position: 10 }]);
    const client = fakeClient(
      [
        'SOURCE: https://pcaobus.org/old',
        'KIND: regulator',
        'WHY: Already there.',
        'CHANGES: Nothing.',
        '',
        'SOURCE: https://sec.gov/new',
        'KIND: regulator',
        'WHY: New staff statement on AI controls.',
        'SUMMARY: The staff say what they expect.',
        'CHANGES: Adds that management must document model changes.',
      ].join('\n'),
      [
        { url: 'https://pcaobus.org/old', title: 'Old page' },
        { url: 'https://sec.gov/new', title: 'Staff statement', page_age: '2 days ago' },
      ],
    );
    const recordSpend = vi.fn(async () => undefined);
    const outcome = await checkBrief(learn, brief, { client: client as never, recordSpend, now: NOW });

    expect(outcome).toEqual({ ok: true, added: 1, readingIds: ['new-0'], quietChecks: 0 });
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      open_url: 'https://sec.gov/new',
      brief_id: 'brief-1',
      track_id: 'track-1',
      found_kind: 'regulator',
      found_change: 'Adds that management must document model changes.',
      position: 20,
    });
    expect(updates).toEqual([{ table: 'briefs', watched_at: new Date(NOW).toISOString(), quiet_checks: 0 }]);
    expect(recordSpend).toHaveBeenCalledWith('user-1', [expect.objectContaining({ model: expect.any(String) })]);
  });

  it('adds nothing and counts a quiet check when nothing new came out', async () => {
    const { learn, inserted, updates } = fakeLearn([]);
    const client = fakeClient('NOTHING NEW', []);
    const outcome = await checkBrief(learn, brief, { client: client as never, recordSpend: async () => undefined, now: NOW });
    expect(outcome).toEqual({ ok: true, added: 0, readingIds: [], quietChecks: 3 });
    expect(inserted).toEqual([]);
    expect(updates[0]).toMatchObject({ quiet_checks: 3 });
  });
});
