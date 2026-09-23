import { describe, expect, it, vi } from 'vitest';
import { bodyText, digestIssue, readDigest, DIGEST_MODEL, DIGEST_OPERATION } from './digest';

/**
 * One stored newsletter into a summary and stories, without a network.
 *
 * The model and both databases are stubs. What is checked is what this code
 * decides around the model: what it is sent, what is saved on the issue for a
 * roundup, a single essay and a failed call, and that the spend is recorded
 * each time a reply came back.
 */

const ISSUE = {
  subject: 'Morning roundup',
  text_body: 'View in browser\r\n\r\nFirst story.͏­\r\n\r\n\r\n\r\nSecond story.',
  html_body: '<p>ignored</p>',
};

function newsClient(row: unknown = ISSUE, saveError: { message: string } | null = null) {
  const updates: Record<string, unknown>[] = [];
  const filters: [string, unknown][] = [];
  const client = {
    from: vi.fn(() => ({
      select: () => {
        const query = {
          eq: (column: string, value: unknown) => {
            filters.push([column, value]);
            return query;
          },
          maybeSingle: async () => ({ data: row, error: null }),
        };
        return query;
      },
      update: (values: Record<string, unknown>) => {
        updates.push(values);
        const query = {
          eq: (column: string, value: unknown) => {
            filters.push([column, value]);
            return query;
          },
          then: (resolve: (value: unknown) => void) => resolve({ error: saveError }),
        };
        return query;
      },
    })),
  };
  return { client: client as never, updates, filters };
}

function spendClient() {
  const insert = vi.fn().mockResolvedValue({ error: null });
  return { client: { from: vi.fn(() => ({ insert })) } as never, insert };
}

const USAGE = { input_tokens: 3000, output_tokens: 400 };

function model(reply: unknown) {
  const create = vi.fn().mockImplementation(async () => {
    if (reply instanceof Error) throw reply;
    return reply;
  });
  return { client: { messages: { create } } as never, create };
}

const reported = (input: unknown) => ({
  content: [{ type: 'tool_use', name: 'report_digest', input }],
  stop_reason: 'tool_use',
  usage: USAGE,
});

async function run(reply: unknown, row: unknown = ISSUE) {
  const news = newsClient(row);
  const spend = spendClient();
  const haiku = model(reply);
  const outcome = await digestIssue({
    news: news.client,
    spend: spend.client,
    userId: 'user-1',
    issueId: 'issue-1',
    anthropicApiKey: 'test',
    client: haiku.client,
  });
  return { outcome, news, spend, haiku };
}

describe('digesting a newsletter', () => {
  it('saves the summary and each story, and records the spend', async () => {
    const { outcome, news, spend, haiku } = await run(
      reported({
        summary: ' Two stories today. ',
        stories: [
          { headline: 'First', summary: 'The first story. It happened.' },
          { headline: 'Second', summary: 'The second story. It also happened.' },
          { headline: '', summary: 'A story with no headline is dropped.' },
        ],
      }),
    );

    const stories = [
      { headline: 'First', summary: 'The first story. It happened.' },
      { headline: 'Second', summary: 'The second story. It also happened.' },
    ];
    expect(outcome).toEqual({ status: 'digested', summary: 'Two stories today.', stories });

    const sent = haiku.create.mock.calls[0][0];
    expect(sent.model).toBe(DIGEST_MODEL);
    expect(sent.tool_choice).toEqual({ type: 'tool', name: 'report_digest' });
    expect(sent.messages[0].content).toBe(
      'Subject: Morning roundup\n\nView in browser\n\nFirst story.\n\nSecond story.',
    );

    expect(news.updates).toHaveLength(1);
    expect(news.updates[0]).toMatchObject({
      summary: 'Two stories today.',
      stories,
      digest_error: null,
    });
    expect(news.updates[0].digested_at).toEqual(expect.any(String));
    expect(news.filters).toContainEqual(['user_id', 'user-1']);
    expect(news.filters).toContainEqual(['id', 'issue-1']);

    expect(spend.insert).toHaveBeenCalledTimes(1);
    expect(spend.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-1',
        module: 'news',
        operation: DIGEST_OPERATION,
        model: DIGEST_MODEL,
        input_tokens: 3000,
        output_tokens: 400,
      }),
    );
  });

  it('gives a single essay its summary and an empty story list', async () => {
    const { outcome, news } = await run(
      reported({ summary: 'One long argument about parking.', stories: [] }),
    );

    expect(outcome).toEqual({
      status: 'digested',
      summary: 'One long argument about parking.',
      stories: [],
    });
    expect(news.updates[0]).toMatchObject({
      summary: 'One long argument about parking.',
      stories: [],
      digest_error: null,
    });
  });

  it('saves the error and leaves the summary empty when the call fails', async () => {
    const { outcome, news, spend } = await run(new Error('529 overloaded'));

    expect(outcome).toEqual({ status: 'failed', error: '529 overloaded' });
    expect(news.updates[0]).toMatchObject({
      summary: null,
      stories: null,
      digest_error: '529 overloaded',
    });
    expect(news.updates[0].digested_at).toEqual(expect.any(String));
    // No reply came back, so there is nothing to record.
    expect(spend.insert).not.toHaveBeenCalled();
  });

  it('saves an error, and still records the spend, when the reply is unusable', async () => {
    const { outcome, news, spend } = await run({
      content: [{ type: 'tool_use', name: 'report_digest', input: { stories: [] } }],
      stop_reason: 'max_tokens',
      usage: USAGE,
    });

    expect(outcome).toEqual({ status: 'failed', error: 'The reply was cut off before it finished.' });
    expect(news.updates[0]).toMatchObject({ summary: null, stories: null });
    expect(spend.insert).toHaveBeenCalledTimes(1);
  });

  it('touches nothing when the issue is not the account\'s', async () => {
    const { outcome, news, spend, haiku } = await run(reported({ summary: 'x', stories: [] }), null);

    expect(outcome).toEqual({ status: 'missing' });
    expect(haiku.create).not.toHaveBeenCalled();
    expect(news.updates).toHaveLength(0);
    expect(spend.insert).not.toHaveBeenCalled();
  });

  it('throws when the outcome cannot be saved', async () => {
    const news = newsClient(ISSUE, { message: 'permission denied' });
    await expect(
      digestIssue({
        news: news.client,
        spend: spendClient().client,
        userId: 'user-1',
        issueId: 'issue-1',
        anthropicApiKey: 'test',
        client: model(reported({ summary: 'Fine.', stories: [] })).client,
      }),
    ).rejects.toThrow('permission denied');
  });
});

describe('the text Haiku reads', () => {
  it('strips the HTML when there is no text body', () => {
    expect(
      bodyText({
        subject: null,
        textBody: null,
        htmlBody:
          '<html><head><style>p{}</style></head><body><p>Rates &amp; bonds</p><p>Oil&nbsp;up</p></body></html>',
      }),
    ).toBe('Rates & bonds\nOil up');
  });
});

describe('reading the report', () => {
  it('refuses a report with a blank summary', () => {
    expect(readDigest({ summary: '  ', stories: [] })).toBe('The model returned no summary.');
  });

  it('reads a missing story list as none', () => {
    expect(readDigest({ summary: 'Fine.' })).toEqual({ summary: 'Fine.', stories: [] });
  });
});
