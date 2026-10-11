/**
 * Scoring ideas and storing the score (plan #1327).
 *
 * What matters: a failed ask writes nothing, so the idea stays null for the
 * next catch-up; a score is only written over a null; the catch-up reads
 * only live unscored ideas, keeps to two a second, and stops at its deadline.
 */
import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ScoreIdeaInput } from '@/lib/ideas/score-ask';
import { scoreIdeaRow, scoreUnscoredIdeas } from '@/lib/ideas/score-run';
import { IDEA_SCORE_VERSION, SCORE_DUE_FILTER, needsScore } from '@/lib/ideas/score';
import type { Triage } from '@/lib/feedback/triage';

type Row = Record<string, unknown>;

/** Enough of the query builder for these reads and updates; filters applied. */
function stub(ideas: Row[], visions: Row[] = []) {
  const updates: { id: unknown; score: unknown }[] = [];
  const client = {
    from(table: string) {
      const filters: Array<(row: Row) => boolean> = [];
      let limit = Infinity;
      let patch: Row | null = null;
      const rows = () => (table === 'ideas' ? ideas : visions).filter((row) => filters.every((f) => f(row)));
      const q = {
        select: () => q,
        update: (value: Row) => {
          patch = value;
          return q;
        },
        eq: (column: string, value: unknown) => {
          filters.push((row) => row[column] === value);
          return q;
        },
        is: (column: string, value: unknown) => {
          filters.push((row) => (row[column] ?? null) === value);
          return q;
        },
        or: (filter: string) => {
          if (filter !== SCORE_DUE_FILTER) throw new Error(`unexpected or filter: ${filter}`);
          filters.push((row) => needsScore(row.score));
          return q;
        },
        order: () => q,
        limit: (n: number) => {
          limit = n;
          return q;
        },
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        then: (resolve: (value: { data: Row[] | null; error: null }) => unknown) => {
          if (patch) {
            for (const row of rows()) {
              Object.assign(row, patch);
              updates.push({ id: row.id, score: patch.score });
            }
            return resolve({ data: null, error: null });
          }
          return resolve({ data: rows().slice(0, limit), error: null });
        },
      };
      return q;
    },
  };
  return { client: client as unknown as SupabaseClient, updates };
}

const USER = 'u1';
const SCORE = { value: 60, confidence: 0.9, at: '2026-09-30T00:00:00.000Z', question: IDEA_SCORE_VERSION };
/** A score asked before the question's wording was numbered: version 1. */
const OLD_SCORE = { value: 25, confidence: 0.9, at: '2026-09-30T00:00:00.000Z' };

function idea(id: string, extra: Row = {}): Row {
  return { id, user_id: USER, body: `idea ${id}`, module: null, triage: null, score: null, dismissed_at: null, ...extra };
}

function asker(fail: Set<string> = new Set()) {
  const asked: ScoreIdeaInput[] = [];
  const ask = async (input: ScoreIdeaInput) => {
    asked.push(input);
    if (fail.has(input.body)) return { ok: false as const, reason: 'error' as const, detail: '500' };
    input.onSpend?.({ model: 'jev', usage: {} } as never);
    return { ok: true as const, score: SCORE };
  };
  return { ask, asked };
}

describe('scoreIdeaRow', () => {
  it('stores the score, reading the idea against its vision and the triage just made', async () => {
    const { client, updates } = stub(
      [idea('a', { module: 'learn' })],
      [{ user_id: USER, module: 'learn', body: 'Learn vision', updated_at: 'x' }],
    );
    const { ask, asked } = asker();
    const triage = { kind: null, module: null, priority: null, duplicate: null } as unknown as Triage;
    const spend: never[] = [];
    const score = await scoreIdeaRow(client, { userId: USER, id: 'a', triage, spend, ask });
    expect(score).toEqual(SCORE);
    expect(updates).toEqual([{ id: 'a', score: SCORE }]);
    expect(asked[0].vision).toBe('Learn vision');
    expect(asked[0].triage).toBe(triage);
    expect(spend).toHaveLength(1);
  });

  it('writes nothing when Jev fails, so the score stays null', async () => {
    const { client, updates } = stub([idea('a')]);
    const score = await scoreIdeaRow(client, { userId: USER, id: 'a', spend: [], ask: asker(new Set(['idea a'])).ask });
    expect(score).toBeNull();
    expect(updates).toEqual([]);
  });

  it('leaves another account’s idea, a dismissed one and a scored one alone', async () => {
    const { client, updates } = stub([
      idea('a', { user_id: 'other' }),
      idea('b', { dismissed_at: '2026-09-01' }),
      idea('c', { score: SCORE }),
    ]);
    const { ask, asked } = asker();
    for (const id of ['a', 'b', 'c']) {
      expect(await scoreIdeaRow(client, { userId: USER, id, spend: [], ask })).toBeNull();
    }
    expect(asked).toEqual([]);
    expect(updates).toEqual([]);
  });
});

describe('scoreUnscoredIdeas', () => {
  it('scores every live unscored idea and counts what Jev failed on', async () => {
    const { client, updates } = stub([
      idea('a'),
      idea('b', { score: SCORE }),
      idea('c', { dismissed_at: '2026-09-01' }),
      idea('d'),
      idea('e'),
    ]);
    const result = await scoreUnscoredIdeas(client, {
      userId: USER,
      spend: [],
      gapMs: 0,
      ask: asker(new Set(['idea d'])).ask,
    });
    expect(result).toEqual({ scored: 2, failed: 1, left: 0 });
    expect(updates.map((u) => u.id)).toEqual(['a', 'e']);
  });

  it('waits so no more than two are asked a second', async () => {
    const { client } = stub([idea('a'), idea('b'), idea('c')]);
    let clock = 0;
    const waits: number[] = [];
    await scoreUnscoredIdeas(client, {
      userId: USER,
      spend: [],
      ask: asker().ask,
      now: () => clock,
      sleep: async (ms) => {
        waits.push(ms);
        clock += ms;
      },
    });
    expect(waits).toEqual([500, 500]);
  });

  it('stops at the limit and at the deadline, and says how many are left', async () => {
    const limited = await scoreUnscoredIdeas(stub([idea('a'), idea('b'), idea('c')]).client, {
      userId: USER,
      spend: [],
      gapMs: 0,
      limit: 2,
      ask: asker().ask,
    });
    expect(limited).toEqual({ scored: 2, failed: 0, left: 1 });

    let clock = 0;
    const { ask } = asker();
    const timed = await scoreUnscoredIdeas(stub([idea('a'), idea('b'), idea('c')]).client, {
      userId: USER,
      spend: [],
      gapMs: 0,
      deadline: 1,
      now: () => clock,
      ask: async (input) => {
        clock += 1;
        return ask(input);
      },
    });
    expect(timed).toEqual({ scored: 1, failed: 0, left: 2 });
  });

  it('asks again an idea scored under an older wording, and keeps the old score when Jev fails', async () => {
    const ideas = [
      idea('a', { score: OLD_SCORE }),
      idea('b', { score: { ...OLD_SCORE, question: IDEA_SCORE_VERSION - 1 } }),
      idea('c', { score: SCORE }),
      idea('d', { score: OLD_SCORE }),
    ];
    const { client, updates } = stub(ideas);
    const result = await scoreUnscoredIdeas(client, {
      userId: USER,
      spend: [],
      gapMs: 0,
      ask: asker(new Set(['idea d'])).ask,
    });
    expect(result).toEqual({ scored: 2, failed: 1, left: 0 });
    expect(updates.map((u) => u.id)).toEqual(['a', 'b']);
    expect(ideas[3].score).toEqual(OLD_SCORE);
  });
});
