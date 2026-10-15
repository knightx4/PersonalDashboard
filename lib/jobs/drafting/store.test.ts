import { describe, expect, it } from 'vitest';
import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import {
  LETTER_KEY,
  clearDrafts,
  dropDraft,
  loadDrafts,
  parseAsks,
  parseDrafts,
  saveDrafts,
  saveReplies,
  withReplies,
  withoutDraft,
  type StoredAsk,
} from './store';

type Row = Record<string, unknown>;

/**
 * Just enough of the query builder for the store: rows kept in memory, one per
 * (application_id, kind), the way the table's unique key keeps them.
 */
function fakeClient(rows: Row[] = []): { client: AppSupabaseClient; rows: Row[] } {
  const matching = (filters: Record<string, unknown>) =>
    rows.filter((r) => Object.entries(filters).every(([k, v]) => r[k] === v));

  function builder(table: string) {
    if (table !== 'application_drafts') throw new Error(`unexpected table ${table}`);
    const filters: Record<string, unknown> = {};
    let mode: 'select' | 'update' | 'delete' = 'select';
    let patch: Row = {};
    const chain = {
      select: () => chain,
      eq: (k: string, v: unknown) => {
        filters[k] = v;
        return chain;
      },
      maybeSingle: async () => ({ data: matching(filters)[0] ?? null, error: null }),
      update: (p: Row) => {
        mode = 'update';
        patch = p;
        return chain;
      },
      delete: () => {
        mode = 'delete';
        return chain;
      },
      upsert: async (row: Row) => {
        const hit = rows.find((r) => r.application_id === row.application_id && r.kind === row.kind);
        if (hit) Object.assign(hit, row, { updated_at: 'later' });
        else rows.push({ ...row, updated_at: 'first' });
        return { error: null };
      },
      // Awaiting the chain runs an update or a delete.
      then: (resolve: (v: { error: null }) => void) => {
        const hits = matching(filters);
        if (mode === 'update') hits.forEach((r) => Object.assign(r, patch));
        if (mode === 'delete') hits.forEach((r) => rows.splice(rows.indexOf(r), 1));
        resolve({ error: null });
      },
    };
    return chain;
  }

  return { client: { from: builder } as unknown as AppSupabaseClient, rows };
}

const ASKS: StoredAsk[] = [
  { id: 'a1', answer_id: 'ans-1', question: 'Which team did you lead?', reply: null },
  { id: 'a2', answer_id: null, question: 'Any salary floor?', reply: null },
];

const DRAFTS = {
  'ans-1': { answer: 'I led the close team.', evidence_item_ids: ['ev-1'], unsupported_claims: ['led ten people'] },
  'ans-2': { answer: 'Because of the product.', evidence_item_ids: [], unsupported_claims: [] },
};

describe('application drafts store', () => {
  it('round-trips a draft with its asks and, after a reload, their replies', async () => {
    const { client } = fakeClient();
    expect((await loadDrafts(client, 'app-1', 'answers')).drafts).toBeNull();

    await saveDrafts(client, 'user-1', 'app-1', 'answers', { drafts: DRAFTS, asks: ASKS });
    const first = (await loadDrafts(client, 'app-1', 'answers')).drafts;
    expect(first?.drafts).toEqual(DRAFTS);
    expect(first?.asks).toEqual(ASKS);

    const saved = await saveReplies(client, 'app-1', 'answers', { a1: 'The close team.' });
    expect(saved).toEqual({ saved: true, error: null });

    const reloaded = (await loadDrafts(client, 'app-1', 'answers')).drafts;
    expect(reloaded?.asks.map((a) => a.reply)).toEqual(['The close team.', null]);
    expect(reloaded?.drafts).toEqual(DRAFTS);
  });

  it('keeps one current row per application and kind, a redraft replacing the last', async () => {
    const { client, rows } = fakeClient();
    await saveDrafts(client, 'user-1', 'app-1', 'answers', { drafts: DRAFTS, asks: ASKS });
    await saveDrafts(client, 'user-1', 'app-1', 'answers', {
      drafts: { 'ans-1': { answer: 'New.', evidence_item_ids: [], unsupported_claims: [] } },
      asks: [],
    });
    await saveDrafts(client, 'user-1', 'app-1', 'cover_letter', {
      drafts: { [LETTER_KEY]: { answer: 'Dear team', evidence_item_ids: ['ev-1'], unsupported_claims: [] } },
      asks: [],
    });
    expect(rows).toHaveLength(2);
    const answers = (await loadDrafts(client, 'app-1', 'answers')).drafts;
    expect(Object.keys(answers?.drafts ?? {})).toEqual(['ans-1']);
    expect(answers?.asks).toEqual([]);
    const letter = (await loadDrafts(client, 'app-1', 'cover_letter')).drafts;
    expect(letter?.drafts[LETTER_KEY].answer).toBe('Dear team');
  });

  it('does not reply to a draft that is not there, and clears one that is', async () => {
    const { client } = fakeClient();
    expect(await saveReplies(client, 'app-1', 'answers', { a1: 'x' })).toEqual({ saved: false, error: null });
    await saveDrafts(client, 'user-1', 'app-1', 'answers', { drafts: DRAFTS, asks: ASKS });
    await clearDrafts(client, 'app-1', 'answers');
    expect((await loadDrafts(client, 'app-1', 'answers')).drafts).toBeNull();
  });

  it('drops one inserted or discarded draft and keeps the rest and every ask', async () => {
    const { client } = fakeClient();
    expect(await dropDraft(client, 'app-1', 'answers', 'ans-1')).toEqual({ error: null });
    await saveDrafts(client, 'user-1', 'app-1', 'answers', { drafts: DRAFTS, asks: ASKS });
    await saveReplies(client, 'app-1', 'answers', { a1: 'The close team.' });
    await dropDraft(client, 'app-1', 'answers', 'ans-1');
    const after = (await loadDrafts(client, 'app-1', 'answers')).drafts;
    expect(Object.keys(after?.drafts ?? {})).toEqual(['ans-2']);
    expect(after?.asks.map((a) => a.reply)).toEqual(['The close team.', null]);
    expect(withoutDraft(DRAFTS, 'nope')).toBe(DRAFTS);
  });
});

describe('reading the stored jsonb', () => {
  it('drops entries that lack an answer, an id or a question, and defaults the lists', () => {
    expect(parseDrafts({ a: { answer: 'ok' }, b: { evidence_item_ids: [] }, c: null })).toEqual({
      a: { answer: 'ok', evidence_item_ids: [], unsupported_claims: [] },
    });
    expect(parseDrafts([])).toEqual({});
    expect(parseAsks([{ id: 'x', question: 'Q' }, { question: 'no id' }, 'junk'])).toEqual([
      { id: 'x', answer_id: null, question: 'Q', reply: null },
    ]);
    expect(parseAsks({})).toEqual([]);
  });

  it('keeps the banned constructions and the limit overrun when a draft has them', () => {
    expect(
      parseDrafts({
        a: {
          answer: 'ok',
          banned_found: ['leverage'],
          over_limit: { count: 12, limit: 10, unit: 'words' },
        },
        b: { answer: 'ok', banned_found: [], over_limit: { count: 'x', limit: 10, unit: 'words' } },
      }),
    ).toEqual({
      a: {
        answer: 'ok',
        evidence_item_ids: [],
        unsupported_claims: [],
        banned_found: ['leverage'],
        over_limit: { count: 12, limit: 10, unit: 'words' },
      },
      b: { answer: 'ok', evidence_item_ids: [], unsupported_claims: [] },
    });
  });

  it('sets, trims and clears replies by ask id', () => {
    const replied = withReplies(ASKS, { a1: '  Finance  ' });
    expect(replied[0].reply).toBe('Finance');
    expect(replied[1]).toBe(ASKS[1]);
    expect(withReplies(replied, { a1: '   ' })[0].reply).toBeNull();
  });
});
