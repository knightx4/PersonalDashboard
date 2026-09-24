import { describe, expect, it, vi } from 'vitest';
import {
  loadRecommendations,
  makeRecommendations,
  RECOMMEND_MODEL,
  RECOMMEND_OPERATION,
} from './make';
import { groupPicks } from './picks';

/**
 * Making the recommended list without a network. The model and both databases
 * are stubs; what is checked is what this code decides around the model.
 */

type Tables = Record<string, { data: unknown; error: { message: string } | null }>;

function newsClient(tables: Tables, upsertError: { message: string } | null = null) {
  const upserts: { table: string; row: Record<string, unknown>; options: unknown }[] = [];
  const client = {
    from: vi.fn((table: string) => {
      const result = tables[table] ?? { data: null, error: null };
      const query: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'not', 'order', 'limit']) query[method] = () => query;
      query.maybeSingle = async () => result;
      query.then = (resolve: (value: unknown) => void) => resolve(result);
      query.upsert = async (row: Record<string, unknown>, options: unknown) => {
        upserts.push({ table, row, options });
        return { error: upsertError };
      };
      return query;
    }),
  };
  return { client: client as never, upserts };
}

function spendClient() {
  const insert = vi.fn().mockResolvedValue({ error: null });
  return { client: { from: vi.fn(() => ({ insert })) } as never, insert };
}

const USAGE = { input_tokens: 40_000, output_tokens: 3_000 };

function model(...replies: unknown[]) {
  const create = vi.fn();
  for (const reply of replies) {
    create.mockImplementationOnce(async () => {
      if (reply instanceof Error) throw reply;
      return reply;
    });
  }
  return { client: { messages: { create } } as never, create };
}

const reported = (picks: unknown[]) => ({
  content: [
    { type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'x' } },
    { type: 'tool_use', id: 't1', name: 'report_newsletters', input: { picks } },
  ],
  stop_reason: 'tool_use',
  usage: USAGE,
});

const paused = {
  content: [{ type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'x' } }],
  stop_reason: 'pause_turn',
  usage: USAGE,
};

const PICKS = [
  {
    name: 'Politico Playbook',
    publisher: 'Politico',
    topic: 'Politics',
    reason: 'A daily morning read on Westminster.',
    link: 'https://www.politico.eu/newsletter/london-playbook/',
  },
  {
    name: 'Quanta Weekly',
    publisher: 'Quanta Magazine',
    topic: 'Science',
    reason: 'A weekly round of maths and physics stories.',
    link: 'https://www.quantamagazine.org/newsletter/',
  },
  {
    name: 'The Download',
    publisher: 'MIT Technology Review',
    topic: 'Technology',
    reason: 'A short daily on what matters in tech.',
    link: 'https://www.technologyreview.com/newsletters/',
  },
  // Already received: Morning Brew is in news.senders.
  {
    name: 'Morning Brew',
    publisher: 'Morning Brew',
    topic: 'Business',
    reason: 'A daily business briefing.',
    link: 'https://www.morningbrew.com/daily',
  },
  // No link.
  {
    name: 'Nature Briefing',
    publisher: 'Nature',
    topic: 'Science',
    reason: 'Daily science news.',
    link: '',
  },
  // Local with no place set.
  {
    name: 'The Mill',
    publisher: 'The Mill',
    topic: 'Local',
    reason: 'Manchester news.',
    link: 'https://manchestermill.co.uk/',
  },
];

const TABLES: Tables = {
  senders: {
    data: [{ email: 'crew@morningbrew.com', name: 'Morning Brew' }],
    error: null,
  },
  issues: {
    data: [
      {
        stories: [
          { headline: 'A', summary: 'a', topic: 'Science' },
          { headline: 'B', summary: 'b', topic: 'Science' },
          { headline: 'C', summary: 'c', topic: 'Other' },
        ],
      },
    ],
    error: null,
  },
  preferences: { data: null, error: null },
};

const NOW = () => new Date('2026-09-24T10:00:00Z');

async function run(replies: unknown[], tables: Tables = TABLES, upsertError = null) {
  const news = newsClient(tables, upsertError);
  const spend = spendClient();
  const opus = model(...replies);
  const result = await makeRecommendations({
    news: news.client,
    spend: spend.client,
    userId: 'user-1',
    anthropicApiKey: 'test',
    client: opus.client,
    now: NOW,
  });
  return { result, news, spend, opus };
}

describe('making the recommended list', () => {
  it('stores the picks grouped by topic, leaving out one you get and one with no link', async () => {
    const { result, news, spend } = await run([reported(PICKS)]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(groupPicks(result.picks).map((g) => [g.topic, g.picks.map((p) => p.name)])).toEqual([
      ['Politics', ['Politico Playbook']],
      ['Technology', ['The Download']],
      ['Science', ['Quanta Weekly']],
    ]);
    expect(result.picks.map((p) => p.name)).not.toContain('Morning Brew');
    expect(result.picks.map((p) => p.name)).not.toContain('Nature Briefing');
    expect(result.picks.map((p) => p.name)).not.toContain('The Mill');

    expect(news.upserts).toEqual([
      {
        table: 'recommendations',
        row: { user_id: 'user-1', picks: result.picks, made_at: '2026-09-24T10:00:00.000Z' },
        options: { onConflict: 'user_id' },
      },
    ]);

    expect(spend.insert).toHaveBeenCalledTimes(1);
    expect(spend.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-1',
        module: 'news',
        operation: RECOMMEND_OPERATION,
        model: RECOMMEND_MODEL,
        input_tokens: 40_000,
        output_tokens: 3_000,
      }),
    );
  });

  it('tells the model the topics, the tally and what you already get, with web search on', async () => {
    const { opus } = await run([reported(PICKS)]);
    const request = opus.create.mock.calls[0][0];
    const prompt = request.messages[0].content as string;
    expect(prompt).toContain('- Science: 2');
    expect(prompt).toContain('- Politics: 0');
    expect(prompt).not.toContain('Local');
    expect(prompt).not.toContain('Other');
    expect(prompt).toContain('Morning Brew, crew@morningbrew.com');
    expect(request.tools[0]).toMatchObject({ type: 'web_search_20260209', name: 'web_search' });
  });

  it('asks for Local and keeps Local picks when a place is set', async () => {
    const { result, opus } = await run([reported(PICKS)], {
      ...TABLES,
      preferences: { data: { local_area: 'Manchester' }, error: null },
    });
    expect(opus.create.mock.calls[0][0].messages[0].content).toContain('Manchester');
    expect(result.ok && result.picks.map((p) => p.name)).toContain('The Mill');
  });

  it('carries on after the server pauses the turn, and records both calls', async () => {
    const { result, opus, spend } = await run([paused, reported(PICKS)]);
    expect(result.ok).toBe(true);
    expect(opus.create).toHaveBeenCalledTimes(2);
    const second = opus.create.mock.calls[1][0].messages;
    expect(second).toHaveLength(2);
    expect(second[1]).toEqual({ role: 'assistant', content: paused.content });
    expect(spend.insert).toHaveBeenCalledTimes(2);
  });

  it('keeps the stored list when the call fails, and says why', async () => {
    const { result, news, spend } = await run([new Error('Overloaded')]);
    expect(result).toEqual({ ok: false, reason: 'error', detail: 'Overloaded' });
    expect(news.upserts).toEqual([]);
    expect(spend.insert).not.toHaveBeenCalled();
  });

  it('keeps the stored list when every pick is dropped, and still records the spend', async () => {
    const { result, news, spend } = await run([reported([PICKS[3], PICKS[4]])]);
    expect(result).toMatchObject({ ok: false, reason: 'nothing-found' });
    expect(news.upserts).toEqual([]);
    expect(spend.insert).toHaveBeenCalledTimes(1);
  });

  it('fails when the reply holds no report', async () => {
    const { result, news } = await run([
      { content: [{ type: 'text', text: 'Sorry' }], stop_reason: 'end_turn', usage: USAGE },
    ]);
    expect(result).toMatchObject({ ok: false, reason: 'error' });
    expect(news.upserts).toEqual([]);
  });

  it('says so when the save fails', async () => {
    const { result } = await run([reported(PICKS)], TABLES, { message: 'denied' } as never);
    expect(result).toMatchObject({ ok: false, reason: 'error' });
  });

  it('does nothing without a key', async () => {
    const news = newsClient(TABLES);
    const result = await makeRecommendations({
      news: news.client,
      spend: spendClient().client,
      userId: 'user-1',
      anthropicApiKey: undefined,
    });
    expect(result).toMatchObject({ ok: false, reason: 'no-key' });
  });
});

describe('reading the stored list', () => {
  it('returns null when none has been made', async () => {
    const news = newsClient({ recommendations: { data: null, error: null } });
    expect(await loadRecommendations(news.client, 'user-1')).toBeNull();
  });

  it('returns the checked picks and when they were made', async () => {
    const news = newsClient({
      recommendations: {
        data: { picks: [PICKS[0], { name: 'junk' }], made_at: '2026-09-24T10:00:00+00:00' },
        error: null,
      },
    });
    expect(await loadRecommendations(news.client, 'user-1')).toEqual({
      picks: [PICKS[0]],
      madeAt: '2026-09-24T10:00:00+00:00',
    });
  });
});
