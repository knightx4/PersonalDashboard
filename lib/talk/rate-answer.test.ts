import { describe, expect, it, vi } from 'vitest';
import {
  parseRating,
  rateAnswer,
  RATING_NOTE_MAX,
  ratingNote,
  ratingPatch,
  type RateAnswerDeps,
  type RatingPatch,
} from './rate-answer';
import { toTalkTurn } from './talk';

/** A thumbs up or down on one of Dash's answers (plan #2285.2). */

const AT = new Date('2026-10-17T09:00:00Z');

/**
 * One account's chat held in memory: turn a1 is Dash's, q1 is theirs, and
 * the read and the write only reach the turns of chat c1, as the signed-in
 * person's client does.
 */
function deps() {
  const turns = new Map<string, { role: 'user' | 'assistant'; patch: RatingPatch | null }>([
    ['q1', { role: 'user', patch: null }],
    ['a1', { role: 'assistant', patch: null }],
  ]);
  const writes: RatingPatch[] = [];
  const base: RateAnswerDeps = {
    readRole: vi.fn(async (conversationId: string, turnId: string) =>
      conversationId === 'c1' ? (turns.get(turnId)?.role ?? null) : null,
    ),
    write: vi.fn(async (conversationId: string, turnId: string, patch: RatingPatch) => {
      const turn = conversationId === 'c1' ? turns.get(turnId) : undefined;
      if (!turn || turn.role !== 'assistant') return 0;
      turn.patch = patch;
      writes.push(patch);
      return 1;
    }),
    now: () => AT,
  };
  return { deps: base, turns, writes };
}

describe('rateAnswer', () => {
  it('keeps a thumbs down with its note and time', async () => {
    const { deps: d, turns } = deps();
    const outcome = await rateAnswer(d, 'c1', 'a1', 'down', 'It missed the bill');
    expect(outcome).toEqual({ ok: true, rating: 'down', note: 'It missed the bill' });
    expect(turns.get('a1')?.patch).toEqual({
      rating: 'down',
      rating_note: 'It missed the bill',
      rated_at: AT.toISOString(),
    });
  });

  it('replaces a thumbs down and its note with a thumbs up', async () => {
    const { deps: d, turns } = deps();
    await rateAnswer(d, 'c1', 'a1', 'down', 'It missed the bill');
    const outcome = await rateAnswer(d, 'c1', 'a1', 'up', 'ignored');
    expect(outcome).toEqual({ ok: true, rating: 'up', note: 'ignored' });
    expect(turns.get('a1')?.patch?.rating).toBe('up');
  });

  it('takes a rating back by clearing all three columns together', async () => {
    const { deps: d, turns } = deps();
    await rateAnswer(d, 'c1', 'a1', 'down', 'It missed the bill');
    const outcome = await rateAnswer(d, 'c1', 'a1', null, 'left over');
    expect(outcome).toEqual({ ok: true, rating: null, note: null });
    expect(turns.get('a1')?.patch).toEqual({ rating: null, rating_note: null, rated_at: null });
  });

  it('refuses the person’s own turn and writes nothing', async () => {
    const { deps: d, writes } = deps();
    const outcome = await rateAnswer(d, 'c1', 'q1', 'up', null);
    expect(outcome).toEqual({ ok: false, error: 'Only Dash’s answers take a thumbs up or down.' });
    expect(writes).toHaveLength(0);
  });

  it('finds nothing in a chat that is not theirs, and writes nothing', async () => {
    const { deps: d, writes } = deps();
    const outcome = await rateAnswer(d, 'someone-elses', 'a1', 'up', null);
    expect(outcome).toEqual({ ok: false, error: 'That answer is not there any more.' });
    expect(d.write).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
  });

  it('says the answer is gone when the write reaches no row', async () => {
    const { deps: d } = deps();
    const outcome = await rateAnswer({ ...d, write: async () => 0 }, 'c1', 'a1', 'up', null);
    expect(outcome).toEqual({ ok: false, error: 'That answer is not there any more.' });
  });
});

describe('the rating as it arrives', () => {
  it('takes up, down and null, and nothing else', () => {
    expect(parseRating('up')).toBe('up');
    expect(parseRating('down')).toBe('down');
    expect(parseRating(null)).toBeNull();
    expect(parseRating('meh')).toBeUndefined();
    expect(parseRating(undefined)).toBeUndefined();
  });

  it('keeps a note trimmed, an empty one as none, and cuts a long one to the limit', () => {
    expect(ratingNote('  wrong bill  ')).toBe('wrong bill');
    expect(ratingNote('   ')).toBeNull();
    expect(ratingNote(42)).toBeNull();
    expect(ratingNote('x'.repeat(RATING_NOTE_MAX + 5))).toHaveLength(RATING_NOTE_MAX);
  });

  it('writes a rating with its time, and clears all three together', () => {
    expect(ratingPatch('up', null, AT)).toEqual({ rating: 'up', rating_note: null, rated_at: AT.toISOString() });
    expect(ratingPatch(null, 'x', AT)).toEqual({ rating: null, rating_note: null, rated_at: null });
  });
});

describe('a reopened chat', () => {
  it('reads each answer’s rating and note back onto the turn', () => {
    const row = { id: 'a1', role: 'assistant', body: 'Nothing.', created_at: 'x' };
    expect(toTalkTurn({ ...row, rating: 'down', rating_note: 'Wrong bill' })).toMatchObject({
      rating: 'down',
      ratingNote: 'Wrong bill',
    });
    expect(toTalkTurn({ ...row, rating: null, rating_note: null })).not.toHaveProperty('rating');
    expect(toTalkTurn({ ...row, role: 'user', rating: 'up' })).not.toHaveProperty('rating');
  });
});
