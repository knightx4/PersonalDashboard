import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import type { NewsSupabaseClient } from '@/lib/news/db/schema-name';
import { scoreIssueImportance } from './importance';
import { IMPORTANCE_QUESTION, ratingFromLevel } from './importance-jev';

/**
 * Rating stored stories with Jev first (plan #1170): the stories Jev is sure
 * of keep its rating, and only the rest go to Haiku, in one call.
 */

type Story = { headline: string; summary: string; topic: string | null; importance?: number };

function fakeNews(stories: Story[]) {
  const row = { stories };
  const builder = {
    select: () => builder,
    eq: () => builder,
    maybeSingle: async () => ({ data: { stories: row.stories }, error: null }),
    update: (next: { stories: Story[] }) => {
      row.stories = next.stories;
      return { eq: () => ({ eq: async () => ({ error: null }) }) };
    },
  };
  return { client: { from: () => builder } as unknown as NewsSupabaseClient, row };
}

function fakeSpend() {
  const rows: Record<string, unknown>[] = [];
  const client = { from: () => ({ insert: async (row: Record<string, unknown>) => (rows.push(row), { error: null }) }) };
  return { client: client as unknown as Pick<CoreSupabaseClient, 'from'>, rows };
}

/** Jev scoring each story from its headline: [level index, confidence], or down when absent. */
function jevScores(byHeadline: Record<string, [number, number]>) {
  return vi.fn(async (_url: unknown, init?: RequestInit) => {
    const sent = JSON.parse(String(init?.body)) as { state: { headline: string } };
    const answer = byHeadline[sent.state.headline];
    if (!answer) return new Response('overloaded', { status: 529 });
    const [score, confidence] = answer;
    return new Response(
      JSON.stringify({
        model: 'jev-1.13.0',
        answers: { answer: { type: 'score', score, confidence, probabilities: { [String(score)]: confidence } } },
        usage: { input_tokens: 100, output_tokens: 0 },
      }),
    );
  }) as unknown as typeof fetch;
}

function haikuRates(ratings: { number: number; importance: number }[]) {
  return vi.fn().mockResolvedValue({
    content: [{ type: 'tool_use', name: 'report_importance', input: { ratings } }],
    stop_reason: 'tool_use',
    usage: { input_tokens: 400, output_tokens: 40 },
  });
}

const stories = (): Story[] => [
  { headline: 'Election called', summary: 'The vote is set.', topic: 'Politics' },
  { headline: 'A quiz', summary: 'Ten questions.', topic: null },
  { headline: 'Chip maker results', summary: 'Sales rose.', topic: 'Business' },
];

describe('scoreIssueImportance with Jev', () => {
  it('keeps the ratings Jev is sure of and sends only the rest to Haiku', async () => {
    const news = fakeNews(stories());
    const spend = fakeSpend();
    const create = haikuRates([{ number: 2, importance: 4 }]);

    const outcome = await scoreIssueImportance({
      news: news.client,
      spend: spend.client,
      userId: 'user-1',
      issueId: 'issue-1',
      client: { messages: { create } } as unknown as Pick<Anthropic, 'messages'>,
      jevEnabled: true,
      jevApiKey: 'jev-key',
      jevFetch: jevScores({ 'Election called': [4, 0.9], 'A quiz': [0, 0.85], 'Chip maker results': [3, 0.5] }),
    });

    expect(outcome).toEqual({ status: 'scored', rated: 3 });
    expect(news.row.stories.map((story) => story.importance)).toEqual([5, 1, 4]);
    // Haiku was sent only the story Jev was unsure of.
    expect(create).toHaveBeenCalledTimes(1);
    const sent = create.mock.calls[0][0] as { messages: { content: string }[] };
    expect(sent.messages[0].content).toBe('2. (Business) Chip maker results: Sales rose.');
    // One spend row per model.
    expect(spend.rows.map((row) => [row.model, row.operation, row.input_tokens])).toEqual([
      ['jev-1.13.0', 'score-importance', 300],
      ['claude-haiku-4-5', 'score-importance', 400],
    ]);
  });

  it('makes no Haiku call when Jev is sure of every story', async () => {
    const news = fakeNews(stories());
    const spend = fakeSpend();
    const create = haikuRates([]);

    const outcome = await scoreIssueImportance({
      news: news.client,
      spend: spend.client,
      userId: 'user-1',
      issueId: 'issue-1',
      client: { messages: { create } } as unknown as Pick<Anthropic, 'messages'>,
      jevEnabled: true,
      jevApiKey: 'jev-key',
      jevFetch: jevScores({ 'Election called': [4, 0.9], 'A quiz': [0, 0.85], 'Chip maker results': [2, 0.8] }),
    });

    expect(outcome).toEqual({ status: 'scored', rated: 3 });
    expect(news.row.stories.map((story) => story.importance)).toEqual([5, 1, 3]);
    expect(create).not.toHaveBeenCalled();
  });

  it('asks nothing of Jev for an account that has not opted in', async () => {
    const news = fakeNews(stories());
    const spend = fakeSpend();
    const jevFetch = vi.fn() as unknown as typeof fetch;
    const create = haikuRates([
      { number: 0, importance: 5 },
      { number: 1, importance: 1 },
      { number: 2, importance: 3 },
    ]);

    await scoreIssueImportance({
      news: news.client,
      spend: spend.client,
      userId: 'user-1',
      issueId: 'issue-1',
      client: { messages: { create } } as unknown as Pick<Anthropic, 'messages'>,
      jevEnabled: false,
      jevApiKey: 'jev-key',
      jevFetch,
    });

    expect(jevFetch).not.toHaveBeenCalled();
    expect(news.row.stories.map((story) => story.importance)).toEqual([5, 1, 3]);
  });

  it('writes nothing when Haiku fails, so the newsletter is tried again whole', async () => {
    const news = fakeNews(stories());
    const spend = fakeSpend();
    const create = vi.fn().mockRejectedValue(new Error('overloaded'));

    const outcome = await scoreIssueImportance({
      news: news.client,
      spend: spend.client,
      userId: 'user-1',
      issueId: 'issue-1',
      client: { messages: { create } } as unknown as Pick<Anthropic, 'messages'>,
      jevEnabled: true,
      jevApiKey: 'jev-key',
      jevFetch: jevScores({ 'Election called': [4, 0.9] }),
    });

    expect(outcome).toMatchObject({ status: 'failed' });
    expect(news.row.stories.every((story) => story.importance === undefined)).toBe(true);
    expect(spend.rows.map((row) => row.model)).toEqual(['jev-1.13.0']);
  });
});

describe('the importance question', () => {
  it('has one level per rating, lowest first', () => {
    expect(IMPORTANCE_QUESTION.levels).toHaveLength(5);
    expect(IMPORTANCE_QUESTION.levels.map((level) => level[0])).toEqual(['1', '2', '3', '4', '5']);
    expect([0, 2, 4].map(ratingFromLevel)).toEqual([1, 3, 5]);
  });
});
