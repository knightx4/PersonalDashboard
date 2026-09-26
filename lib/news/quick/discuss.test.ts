import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TalkRole, TalkTurn } from '@/lib/talk/talk';
import {
  DISCUSS_ROUNDS,
  discussGuidance,
  discussionClosed,
  roundsTaken,
  storyMaterial,
  storyRef,
  storySubject,
} from './discuss';

const ISSUE = '6f1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

const turn = (role: TalkRole, body = 'x'): Pick<TalkTurn, 'role' | 'body'> => ({ role, body });

describe('discuss rules', () => {
  it('names a story by issue id and story index', () => {
    expect(storyRef(ISSUE, 3)).toBe(`${ISSUE}:3`);
    expect(storySubject(ISSUE, 0, 'Rates held')).toEqual({
      kind: 'news_story',
      ref: `${ISSUE}:0`,
      title: 'Rates held',
    });
  });

  it('gives Dash the summary and the story text, skipping what is missing', () => {
    expect(storyMaterial({ summary: 'Short.', text: 'Long text.' })).toBe('Short.\n\nLong text.');
    expect(storyMaterial({ summary: 'Short.' })).toBe('Short.');
  });

  it('counts rounds by Dash replies and closes after the last', () => {
    const thread = [turn('user'), turn('assistant'), turn('user'), turn('user'), turn('assistant')];
    expect(roundsTaken(thread)).toBe(2);
    expect(discussionClosed(thread)).toBe(false);
    expect(discussionClosed([...thread, turn('user'), turn('assistant')])).toBe(true);
  });

  it('asks a question in the early rounds and closes with one line in the last', () => {
    for (let round = 1; round < DISCUSS_ROUNDS; round++) {
      expect(discussGuidance(round)).toContain('End with one pointed question');
      expect(discussGuidance(round)).not.toContain('LAST REPLY');
    }
    const last = discussGuidance(DISCUSS_ROUNDS);
    expect(last).toContain('THIS IS THE LAST REPLY');
    expect(last).toContain('Where your view');
    expect(last).not.toContain('End with one pointed question');
    for (const round of [1, DISCUSS_ROUNDS]) {
      expect(discussGuidance(round)).toContain('Do not tell them what to think');
      expect(discussGuidance(round)).toContain('the story does not');
    }
  });
});

// The action, with the database and the model faked: a view and two replies
// get two counterpoints and a closing line, and a fourth turn is refused.

const store = vi.hoisted(() => ({
  turns: [] as TalkTurn[],
  guidance: [] as string[],
  material: [] as string[],
  spend: [] as unknown[],
  clock: 0,
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/auth/server', () => ({ requireUser: async () => ({ id: 'user-1' }) }));
vi.mock('@/lib/env', () => ({ serverEnv: () => ({ ANTHROPIC_API_KEY: 'test-key' }) }));
vi.mock('@/lib/core/auth/server', () => ({ createCoreClient: async () => ({}) }));
vi.mock('@/lib/core/spend/record', () => ({
  recordSpend: async (_c: unknown, _u: string, record: unknown) => {
    store.spend.push(record);
    return true;
  },
}));
vi.mock('@/lib/news/auth/server', () => ({
  createNewsClient: async () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: {
              stories: [
                { headline: 'Other', summary: 'Other.' },
                { headline: 'Rates held', summary: 'The bank held rates.', text: 'In full.' },
              ],
            },
            error: null,
          }),
        }),
      }),
    }),
  }),
}));
vi.mock('@/lib/talk/store', () => ({
  loadConversation: async () => [...store.turns],
  appendTurns: async (
    _core: unknown,
    _user: string,
    subject: { ref: string },
    turns: { role: TalkRole; body: string }[],
  ) => {
    expect(subject.ref).toBe(`${ISSUE}:1`);
    const kept = turns.map((t) => ({
      id: `t${++store.clock}`,
      role: t.role,
      body: t.body,
      createdAt: new Date(store.clock * 1000).toISOString(),
    }));
    store.turns.push(...kept);
    return kept;
  },
}));
vi.mock('@/lib/talk/reply', () => ({
  replyAbout: async (input: {
    guidance: string;
    subject: { material: string };
    onSpend?: (r: { model: string; usage: unknown }) => void;
  }) => {
    store.guidance.push(input.guidance);
    store.material.push(input.subject.material);
    input.onSpend?.({ model: 'claude-sonnet-5', usage: {} });
    const last = input.guidance.includes('LAST REPLY');
    return {
      ok: true,
      reply: last ? 'Fair.\n\nWhere your view stands: held on X, thin on Y.' : 'But consider Z?',
    };
  },
}));

describe('discussQuickStory', () => {
  beforeEach(() => {
    store.turns = [];
    store.guidance = [];
    store.material = [];
    store.spend = [];
    store.clock = 0;
  });

  it('runs three rounds, closes, and keeps the exchange for the next open', async () => {
    const { discussQuickStory, loadStoryDiscussion } = await import('@/app/news/quick/actions');

    const first = await discussQuickStory(ISSUE, 1, 'I think holding was right.');
    const second = await discussQuickStory(ISSUE, 1, 'Inflation is still high.');
    const third = await discussQuickStory(ISSUE, 1, 'Wages too.');
    for (const result of [first, second, third]) {
      expect(result.error).toBeUndefined();
      expect(result.turns?.map((t) => t.role)).toEqual(['user', 'assistant']);
    }
    expect(first.turns?.[1]?.body).toBe('But consider Z?');
    expect(second.turns?.[1]?.body).toBe('But consider Z?');
    expect(third.turns?.[1]?.body).toContain('Where your view stands:');

    expect(store.guidance[0]).toContain('End with one pointed question');
    expect(store.guidance[1]).toContain('End with one pointed question');
    expect(store.guidance[2]).toContain('THIS IS THE LAST REPLY');
    expect(store.material[0]).toBe('The bank held rates.\n\nIn full.');
    expect(store.spend).toHaveLength(3);
    expect(store.spend[0]).toMatchObject({ module: 'news', operation: 'discuss-story' });

    const fourth = await discussQuickStory(ISSUE, 1, 'One more thing.');
    expect(fourth.error).toMatch(/three rounds/);
    expect(store.turns).toHaveLength(6);

    const reopened = await loadStoryDiscussion(ISSUE, 1);
    expect(reopened.error).toBeNull();
    expect(reopened.turns.map((t) => t.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
      'user',
      'assistant',
    ]);
  });

  it('refuses a story index the newsletter does not have', async () => {
    const { discussQuickStory } = await import('@/app/news/quick/actions');
    const result = await discussQuickStory(ISSUE, 7, 'A view.');
    expect(result.error).toMatch(/no longer in its newsletter/);
    expect(store.turns).toHaveLength(0);
  });
});
