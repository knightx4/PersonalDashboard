/**
 * Too hard or too easy on a Learn now card (plan #890).
 *
 * The action runs through the person's own session, where RLS hides every
 * card that is not theirs. The fake client below keeps that rule: an update
 * reaches only rows owned by the signed-in user, which is what lets the test
 * show a rating on somebody else's card being refused.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Card = { id: string; user_id: string; status: string; difficulty: string | null };

const ME = '00000000-0000-4000-8000-000000000001';
const MINE = '11111111-1111-4111-8111-111111111111';
const THEIRS = '22222222-2222-4222-8222-222222222222';

const state = vi.hoisted(() => ({ cards: [] as Card[], topUps: 0 }));

vi.mock('next/server', () => ({
  after: () => {
    state.topUps += 1;
  },
}));
vi.mock('next/navigation', () => ({ redirect: () => {} }));
vi.mock('@/inngest/learn/feed-top-up', () => ({ topUpFeedAfterResponse: async () => {} }));
vi.mock('@/lib/learn/feed/test-me', () => ({ startTrackFromCard: async () => ({ ok: false }) }));
vi.mock('@/lib/learn/tracks/save', () => ({
  SAVED_FROM_FEED: 'Saved',
  saveFeedSection: async () => ({}),
}));
vi.mock('@/lib/auth/server', () => ({
  requireUser: async () => ({ id: ME, email: 'me@example.com' }),
}));
vi.mock('@/lib/learn/auth/server', () => ({
  createLearnClient: async () => ({
    from: () => ({
      update: (patch: Partial<Card>) => ({
        eq: (_column: 'id', id: string) => ({
          select: async () => {
            const hit = state.cards.filter((card) => card.id === id && card.user_id === ME);
            for (const card of hit) Object.assign(card, patch);
            return { data: hit.map((card) => ({ id: card.id })), error: null };
          },
        }),
      }),
    }),
  }),
}));

const { rateCard } = await import('@/app/learn/now/actions');

function card(id: string): Card {
  return state.cards.find((c) => c.id === id)!;
}

beforeEach(() => {
  state.topUps = 0;
  state.cards = [
    { id: MINE, user_id: ME, status: 'ready', difficulty: null },
    { id: THEIRS, user_id: 'someone-else', status: 'ready', difficulty: null },
  ];
});

describe('rateCard', () => {
  it('sets, changes and clears the rating on the owner card', async () => {
    expect(await rateCard(MINE, 'too_hard')).toEqual({});
    expect(card(MINE).difficulty).toBe('too_hard');

    expect(await rateCard(MINE, 'too_easy')).toEqual({});
    expect(card(MINE).difficulty).toBe('too_easy');

    expect(await rateCard(MINE, null)).toEqual({});
    expect(card(MINE).difficulty).toBeNull();
  });

  it('leaves the card where it is and asks for no top-up', async () => {
    await rateCard(MINE, 'too_hard');
    expect(card(MINE).status).toBe('ready');
    expect(state.topUps).toBe(0);
  });

  it('refuses a card that belongs to somebody else', async () => {
    const result = await rateCard(THEIRS, 'too_easy');
    expect(result.error).toBe('That card is no longer there.');
    expect(card(THEIRS).difficulty).toBeNull();
  });

  it('refuses a rating it does not know and an id that is not one', async () => {
    const result = await rateCard(MINE, 'boring' as never);
    expect(result.error).toBe('Could not tell which rating that was.');
    expect(card(MINE).difficulty).toBeNull();

    expect((await rateCard('not-a-uuid', 'too_hard')).error).toBe(
      'Could not tell which card that was.',
    );
  });
});
