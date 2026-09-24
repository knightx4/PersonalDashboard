import { describe, expect, it, vi } from 'vitest';
import { EMPTY_USAGE } from '@/lib/core/spend/pricing';
import type { embedTexts } from '@/lib/learn/embed/embed';
import { groupStories, matchStories, GROUP_OPERATION, STORY_MATCH_CUTOFF } from './groups';

/**
 * Which stories are the same event, without a network or a database.
 *
 * The embedding call and both clients are stubs. What is checked is what this
 * code decides: that a story joins the group of its closest match at or above
 * the cut-off, that one with no match starts a group of its own, that only
 * other newsletters from two days either side are compared, and that a failed
 * embedding leaves the issue ungrouped with its spend still recorded.
 */

const WIDTH = 1024;

/** A unit vector leaning `weight` of the way from axis `a` towards axis `b`. */
function vec(a: number, b = a, weight = 0): number[] {
  const v = new Array<number>(WIDTH).fill(0);
  v[a] += 1 - weight;
  v[b] += weight;
  return v;
}

const literal = (v: number[]) => `[${v.join(',')}]`;

const STORIES = [
  { headline: 'Tram returns', summary: 'Cities lay track again.' },
  { headline: 'Rain in July', summary: 'It rained a lot.' },
];

type Stored = { group_id: string; embedding: string };

function newsClient(opts: {
  issue?: unknown;
  nearby?: { id: string }[];
  stored?: Stored[];
}) {
  const calls: { table: string; ops: unknown[][] }[] = [];
  const upserts: { rows: Record<string, unknown>[]; options: unknown }[] = [];
  const client = {
    from: vi.fn((table: string) => {
      const call = { table, ops: [] as unknown[][] };
      calls.push(call);
      const result = () => {
        if (table === 'issues') return { data: opts.nearby ?? [], error: null };
        return { data: opts.stored ?? [], error: null };
      };
      const query: Record<string, unknown> = {};
      for (const op of ['select', 'eq', 'neq', 'gte', 'lte', 'in']) {
        query[op] = (...args: unknown[]) => (call.ops.push([op, ...args]), query);
      }
      query.maybeSingle = async () => ({
        data: opts.issue === undefined ? null : opts.issue,
        error: null,
      });
      query.upsert = async (rows: Record<string, unknown>[], options: unknown) => {
        upserts.push({ rows, options });
        return { error: null };
      };
      query.then = (resolve: (value: unknown) => void) => resolve(result());
      return query;
    }),
  };
  return { client: client as never, calls, upserts };
}

function spendClient() {
  const insert = vi.fn().mockResolvedValue({ error: null });
  return { client: { from: vi.fn(() => ({ insert })) } as never, insert };
}

function embedding(vectors: number[][]): typeof embedTexts {
  return async (input) => {
    input.onSpend?.({ model: 'voyage-4-lite', usage: { ...EMPTY_USAGE, inputTokens: 40 } });
    return { ok: true, vectors, model: 'voyage-4-lite', tokens: 40 };
  };
}

const ISSUE = { sender_id: 'sender-1', received_at: '2026-09-24T08:00:00Z', stories: STORIES };

async function run(opts: Parameters<typeof newsClient>[0], embed: typeof embedTexts) {
  const news = newsClient(opts);
  const spend = spendClient();
  let n = 0;
  const outcome = await groupStories({
    news: news.client,
    spend: spend.client,
    userId: 'user-1',
    issueId: 'issue-new',
    embed,
    newGroupId: () => `new-group-${(n += 1)}`,
  });
  return { outcome, news, spend };
}

describe('matchStories', () => {
  it('takes the closest candidate at or above the cut-off', () => {
    const matches = matchStories(
      [vec(0)],
      [
        { groupId: 'far', vector: vec(0, 1, 0.2) },
        { groupId: 'near', vector: vec(0, 1, 0.1) },
      ],
    );
    expect(matches[0]?.groupId).toBe('near');
  });

  it('matches nothing below the cut-off', () => {
    // 0.75 to 0.80 were different stories in #872's week.
    const tilt = vec(0, 1, 0.43);
    const similarity = 0.57 / Math.hypot(0.57, 0.43);
    expect(similarity).toBeLessThan(STORY_MATCH_CUTOFF);
    expect(similarity).toBeGreaterThan(0.75);
    expect(matchStories([vec(0)], [{ groupId: 'g', vector: tilt }])).toEqual([null]);
  });
});

describe('groupStories', () => {
  it('puts a repeated story in the group of the story it repeats, and leaves the other alone', async () => {
    const { outcome, news } = await run(
      {
        issue: ISSUE,
        nearby: [{ id: 'issue-old' }],
        stored: [
          { group_id: 'tram-group', embedding: literal(vec(0, 5, 0.05)) },
          { group_id: 'other-group', embedding: literal(vec(7)) },
        ],
      },
      embedding([vec(0), vec(3)]),
    );

    expect(outcome).toEqual({ status: 'grouped', stories: 2, matched: 1 });
    const [{ rows, options }] = news.upserts;
    expect(options).toEqual({ onConflict: 'issue_id,story_index' });
    expect(rows.map((row) => [row.story_index, row.group_id])).toEqual([
      [0, 'tram-group'],
      [1, 'new-group-1'],
    ]);
    expect(rows[0].similarity).toBeGreaterThanOrEqual(STORY_MATCH_CUTOFF);
    expect(rows[1].similarity).toBeNull();
    expect(rows[0]).toMatchObject({ user_id: 'user-1', issue_id: 'issue-new', embedding_model: 'voyage-4-lite' });
    expect(rows[0].embedding).toBe(literal(vec(0)));
  });

  it('compares only other newsletters from two days either side', async () => {
    const { news } = await run(
      { issue: ISSUE, nearby: [{ id: 'issue-old' }] },
      embedding([vec(0), vec(3)]),
    );

    const nearby = news.calls[1];
    expect(nearby.table).toBe('issues');
    expect(nearby.ops).toEqual([
      ['select', 'id'],
      ['eq', 'user_id', 'user-1'],
      ['neq', 'sender_id', 'sender-1'],
      ['gte', 'received_at', '2026-09-22T08:00:00.000Z'],
      ['lte', 'received_at', '2026-09-26T08:00:00.000Z'],
    ]);
    expect(news.calls[2].ops).toContainEqual(['in', 'issue_id', ['issue-old']]);
  });

  it('starts a group for every story when nothing arrived nearby', async () => {
    const { outcome, news } = await run({ issue: ISSUE, nearby: [] }, embedding([vec(0), vec(3)]));

    expect(outcome).toEqual({ status: 'grouped', stories: 2, matched: 0 });
    // No stored stories are read when there is nothing to compare with.
    expect(news.calls.map((call) => call.table)).toEqual(['issues', 'issues', 'story_groups']);
    expect(news.upserts[0].rows.map((row) => row.group_id)).toEqual(['new-group-1', 'new-group-2']);
  });

  it('re-groups a re-summarised issue by its new positions', async () => {
    // digestIssue has cleared the old rows; the new stories are grouped afresh.
    const resummarised = { ...ISSUE, stories: [STORIES[1], STORIES[0]] };
    const { news } = await run(
      {
        issue: resummarised,
        nearby: [{ id: 'issue-old' }],
        stored: [{ group_id: 'tram-group', embedding: literal(vec(0)) }],
      },
      embedding([vec(3), vec(0)]),
    );

    expect(news.upserts[0].rows.map((row) => [row.story_index, row.group_id])).toEqual([
      [0, 'new-group-1'],
      [1, 'tram-group'],
    ]);
  });

  it('records the spend under news', async () => {
    const { spend } = await run({ issue: ISSUE }, embedding([vec(0), vec(3)]));

    expect(spend.insert).toHaveBeenCalledWith(
      expect.objectContaining({ module: 'news', operation: GROUP_OPERATION }),
    );
  });

  it('leaves the issue ungrouped when the stories cannot be embedded', async () => {
    const { outcome, news } = await run({ issue: ISSUE }, async () => ({
      ok: false,
      reason: 'rate-limited',
      detail: '429',
      tokens: 0,
    }));

    expect(outcome).toEqual({ status: 'not-embedded', reason: 'rate-limited: 429' });
    expect(news.upserts).toEqual([]);
  });

  it('does nothing for an issue with no stories', async () => {
    const embed = vi.fn();
    const { outcome } = await run({ issue: { ...ISSUE, stories: [] } }, embed as never);

    expect(outcome).toEqual({ status: 'no-stories' });
    expect(embed).not.toHaveBeenCalled();
  });
});
