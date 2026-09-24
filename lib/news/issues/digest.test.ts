import { describe, expect, it, vi } from 'vitest';
import {
  bodyText,
  digestIssue,
  readDigest,
  readLine,
  writeDigest,
  DIGEST_MODEL,
  DIGEST_OPERATION,
  LINE_CHARS,
} from './digest';
import { NEWS_TOPICS } from './topics';

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

function newsClient(
  row: unknown = ISSUE,
  saveError: { message: string } | null = null,
  clearError: { message: string } | null = null,
) {
  const updates: Record<string, unknown>[] = [];
  const filters: [string, unknown][] = [];
  // Each delete, as the table it ran on and the filters it carried.
  const deletes: { table: string; filters: [string, unknown][] }[] = [];
  const client = {
    from: vi.fn((table: string) => ({
      delete: () => {
        const removal = { table, filters: [] as [string, unknown][] };
        deletes.push(removal);
        const query = {
          eq: (column: string, value: unknown) => {
            removal.filters.push([column, value]);
            return query;
          },
          then: (resolve: (value: unknown) => void) => resolve({ error: clearError }),
        };
        return query;
      },
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
  return { client: client as never, updates, filters, deletes };
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
  it('saves the line, the summary and each story, and records the spend', async () => {
    const { outcome, news, spend, haiku } = await run(
      reported({
        line: ' Two stories:\nthe first and the second. ',
        summary: ' Two stories today. ',
        stories: [
          { headline: 'First', summary: 'The first story. It happened.', topic: 'Business' },
          {
            headline: 'Second',
            summary: 'The second story. It also happened.',
            topic: ' technology ',
          },
          { headline: '', summary: 'A story with no headline is dropped.', topic: 'World' },
        ],
      }),
    );

    const stories = [
      { headline: 'First', summary: 'The first story. It happened.', topic: 'Business' },
      { headline: 'Second', summary: 'The second story. It also happened.', topic: 'Technology' },
    ];
    expect(outcome).toEqual({
      status: 'digested',
      line: 'Two stories: the first and the second.',
      summary: 'Two stories today.',
      stories,
    });

    const sent = haiku.create.mock.calls[0][0];
    expect(sent.model).toBe(DIGEST_MODEL);
    expect(sent.tool_choice).toEqual({ type: 'tool', name: 'report_digest' });
    expect(sent.tools[0].input_schema.required).toContain('line');
    const storySchema = sent.tools[0].input_schema.properties.stories.items;
    expect(storySchema.required).toContain('topic');
    expect(storySchema.properties.topic.enum).toEqual([...NEWS_TOPICS]);
    expect(sent.system).toContain(`TOPIC. For each story, pick the one topic from this list`);
    expect(sent.system).toContain(NEWS_TOPICS.join(', '));
    expect(sent.system).toContain(`at most ${LINE_CHARS} characters`);
    // A section of short items is where stories went missing (Morning Brew's
    // "Tour de headlines"), so the prompt names it.
    expect(sent.system).toContain('Each item in such\na section is a story of its own');
    expect(sent.messages[0].content).toBe(
      'Subject: Morning roundup\n\nView in browser\n\nFirst story.\n\nSecond story.',
    );

    expect(news.updates).toHaveLength(1);
    expect(news.updates[0]).toMatchObject({
      summary: 'Two stories today.',
      summary_line: 'Two stories: the first and the second.',
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

  it('stores the email\'s own address for a story Haiku gave a link number', async () => {
    const tracked = 'https://link.example.com/click/6aac/aHR0cHM6Ly9leGFtcGxlLmNvbS9h/9f?x=1&y=2';
    const { outcome, news, haiku } = await run(
      reported({
        summary: 'Two stories.',
        stories: [
          { headline: 'Paramount', summary: 'It may leave LA. Critics call it a bluff.', link: 1 },
          { headline: 'Oil', summary: 'Oil fell. Nobody linked it.' },
        ],
      }),
      {
        subject: 'Roundup',
        text_body: 'Paramount may leave LA.\n\nOil fell.',
        html_body: `<p><a href="${tracked.replace('&', '&amp;')}">Paramount may leave LA</a></p><p>Oil fell.</p>`,
      },
    );

    expect(haiku.create.mock.calls[0][0].messages[0].content).toBe(
      'Subject: Roundup\n\nParamount may leave LA [link 1]\nOil fell.',
    );
    const stories = [
      {
        headline: 'Paramount',
        summary: 'It may leave LA. Critics call it a bluff.',
        link: tracked,
        topic: 'Other',
      },
      { headline: 'Oil', summary: 'Oil fell. Nobody linked it.', topic: 'Other' },
    ];
    expect(outcome).toEqual({ status: 'digested', line: null, summary: 'Two stories.', stories });
    expect(news.updates[0]).toMatchObject({ stories });
  });

  it('gives a single essay its summary and an empty story list', async () => {
    const { outcome, news } = await run(
      reported({
        line: 'An argument about parking',
        summary: 'One long argument about parking.',
        stories: [],
      }),
    );

    expect(outcome).toEqual({
      status: 'digested',
      line: 'An argument about parking',
      summary: 'One long argument about parking.',
      stories: [],
    });
    expect(news.updates[0]).toMatchObject({
      summary: 'One long argument about parking.',
      summary_line: 'An argument about parking',
      stories: [],
      digest_error: null,
    });
  });

  it('still saves the summary when the reply leaves the line out', async () => {
    const { outcome, news } = await run(reported({ summary: 'Two stories.', stories: [] }));

    expect(outcome).toEqual({ status: 'digested', line: null, summary: 'Two stories.', stories: [] });
    expect(news.updates[0]).toMatchObject({
      summary: 'Two stories.',
      summary_line: null,
      digest_error: null,
    });
  });

  it('saves the error and leaves the summary empty when the call fails', async () => {
    const { outcome, news, spend } = await run(new Error('529 overloaded'));

    expect(outcome).toEqual({ status: 'failed', error: '529 overloaded' });
    expect(news.updates[0]).toMatchObject({
      summary: null,
      summary_line: null,
      stories: null,
      digest_error: '529 overloaded',
    });
    expect(news.updates[0].digested_at).toEqual(expect.any(String));
    // No reply came back, so there is nothing to record.
    expect(spend.insert).not.toHaveBeenCalled();
  });

  it('rewrites a summarised issue in place, with its line', async () => {
    const { outcome, news } = await run(
      reported({ summary: 'New.', line: 'A new line', stories: [] }),
      { ...ISSUE, summary: 'Old.' },
    );

    expect(outcome).toMatchObject({ status: 'digested', line: 'A new line' });
    expect(news.updates[0]).toMatchObject({
      summary: 'New.',
      summary_line: 'A new line',
      stories: [],
      digest_error: null,
    });
  });

  it('keeps the old summary when a redo fails, and moves only digested_at', async () => {
    const { outcome, news } = await run(new Error('529 overloaded'), { ...ISSUE, summary: 'Old.' });

    expect(outcome).toEqual({ status: 'failed', error: '529 overloaded' });
    expect(Object.keys(news.updates[0])).toEqual(['digested_at']);
    // The stories did not change, so what was passed still names them.
    expect(news.deletes).toEqual([]);
  });

  it('clears the stories passed and their groups when a redo rewrites them', async () => {
    const { news } = await run(
      reported({ summary: 'New.', stories: [{ headline: 'First', summary: 'One. Two.' }] }),
      { ...ISSUE, summary: 'Old.' },
    );

    const filters = [
      ['issue_id', 'issue-1'],
      ['user_id', 'user-1'],
    ];
    expect(news.deletes).toEqual([
      { table: 'story_passes', filters },
      { table: 'story_groups', filters },
    ]);
  });

  it('clears nothing on a first summary, which has no passes yet', async () => {
    const { news } = await run(reported({ summary: 'Two stories.', stories: [] }));

    expect(news.deletes).toEqual([]);
  });

  it('throws when the passes cannot be cleared', async () => {
    const news = newsClient({ ...ISSUE, summary: 'Old.' }, null, { message: 'permission denied' });
    await expect(
      digestIssue({
        news: news.client,
        spend: spendClient().client,
        userId: 'user-1',
        issueId: 'issue-1',
        anthropicApiKey: 'test',
        client: model(reported({ summary: 'Fine.', stories: [] })).client,
      }),
    ).rejects.toThrow('clearing story_passes failed (permission denied)');
    // The new summary was saved first; the passes are what failed.
    expect(news.updates).toHaveLength(1);
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
    ).toEqual({ text: 'Rates & bonds\nOil up', links: [], images: [] });
  });

  it('reads the HTML when it has links, numbering each address once', () => {
    expect(
      bodyText({
        subject: null,
        textBody: 'Rates rose. Oil fell.',
        htmlBody:
          '<p><a href="https://t.example/c/1?a=1&amp;b=2"><b>Rates rose</b></a></p>' +
          "<p><a class='x' href='https://t.example/c/2'>Oil fell</a>" +
          ' <a href="https://t.example/c/1?a=1&amp;b=2">more</a>' +
          ' <a href="mailto:ed@example.com">write to us</a></p>',
      }),
    ).toEqual({
      text: 'Rates rose [link 1]\nOil fell [link 2] more [link 1] write to us',
      links: ['https://t.example/c/1?a=1&b=2', 'https://t.example/c/2'],
      images: [],
    });
  });

  it('numbers each picture where it sat, skipping pixels and icons', () => {
    expect(
      bodyText({
        subject: null,
        textBody: 'MIT is first.',
        htmlBody:
          '<p><img src="https://cdn.example/logo.png" alt="Brew"></p>' +
          '<h2><a href="https://t.example/c/1">MIT is first</a></h2>' +
          '<p><a href="https://t.example/c/1"><img src="https://cdn.example/mit.jpg?w=600&amp;h=400"></a></p>' +
          '<p>Rankings out.</p>' +
          '<img src="https://open.example/o/abc" width="1" height="1">' +
          '<img src="https://cdn.example/spacer.gif" style="display:block; width:1px">' +
          '<img src="https://cdn.example/share.png" style="width:25px;display:inline-block">' +
          '<img src="https://cdn.example/arrow.png" width="20" style="width:22%">' +
          '<img src="https://cdn.example/wide.jpg" width="670" style="width:100%;max-width:670px">' +
          '<img src="data:image/gif;base64,R0lGOD">',
      }),
    ).toEqual({
      text: '[image 1]\nMIT is first [link 1]\n[image 2] [link 1]\nRankings out.\n[image 3]',
      links: ['https://t.example/c/1'],
      images: [
        'https://cdn.example/logo.png',
        'https://cdn.example/mit.jpg?w=600&h=400',
        'https://cdn.example/wide.jpg',
      ],
    });
  });

  it('numbers no pictures when the text body is what is read', () => {
    expect(
      bodyText({
        subject: null,
        textBody: 'Rates rose.',
        htmlBody: '<p><img src="https://cdn.example/a.jpg">Rates rose.</p>',
      }),
    ).toEqual({ text: 'Rates rose.', links: [], images: [] });
  });

  it('numbers the addresses a text body writes out when the HTML has no links', () => {
    expect(
      bodyText({
        subject: null,
        textBody:
          'Rates rose [ https://substack.com/redirect/abc ] and oil fell (https://t.example/2).\nhttps://t.example/3',
        htmlBody: '<p>no links</p>',
      }),
    ).toEqual({
      text: 'Rates rose [link 1] and oil fell [link 2] .\n[link 3]',
      links: ['https://substack.com/redirect/abc', 'https://t.example/2', 'https://t.example/3'],
      images: [],
    });
  });
});

describe('reading the report', () => {
  it('refuses a report with a blank summary', () => {
    expect(readDigest({ summary: '  ', stories: [] })).toBe('The model returned no summary.');
  });

  it('puts the address behind each link number on its story', () => {
    const links = ['https://t.example/c/1', 'https://t.example/c/2'];
    expect(
      readDigest(
        {
          summary: 'Two stories.',
          stories: [
            { headline: 'Linked', summary: 'Has a link.', link: 2 },
            { headline: 'Unlinked', summary: 'Has none.' },
            { headline: 'Made up', summary: 'Its number is not in the email.', link: 3 },
            { headline: 'Zero', summary: 'Numbers start at one.', link: 0 },
            { headline: 'Quoted', summary: 'A number sent as text.', link: '1' },
          ],
        },
        links,
      ),
    ).toEqual({
      line: null,
      summary: 'Two stories.',
      stories: [
        {
          headline: 'Linked',
          summary: 'Has a link.',
          link: 'https://t.example/c/2',
          topic: 'Other',
        },
        { headline: 'Unlinked', summary: 'Has none.', topic: 'Other' },
        { headline: 'Made up', summary: 'Its number is not in the email.', topic: 'Other' },
        { headline: 'Zero', summary: 'Numbers start at one.', topic: 'Other' },
        {
          headline: 'Quoted',
          summary: 'A number sent as text.',
          link: 'https://t.example/c/1',
          topic: 'Other',
        },
      ],
    });
  });

  it('puts the picture behind each image number on its story', () => {
    const images = ['https://cdn.example/logo.png', 'https://cdn.example/mit.jpg'];
    expect(
      readDigest(
        {
          summary: 'Two stories.',
          stories: [
            { headline: 'MIT', summary: 'MIT is first.', image: 2 },
            { headline: 'Made up', summary: 'No such picture.', image: 9 },
          ],
        },
        [],
        images,
      ),
    ).toEqual({
      line: null,
      summary: 'Two stories.',
      stories: [
        {
          headline: 'MIT',
          summary: 'MIT is first.',
          image: 'https://cdn.example/mit.jpg',
          topic: 'Other',
        },
        { headline: 'Made up', summary: 'No such picture.', topic: 'Other' },
      ],
    });
  });

  it("keeps each story's own text, without any markers left in it", () => {
    expect(
      readDigest({
        summary: 'One story.',
        stories: [
          {
            headline: 'MIT',
            summary: 'MIT is first.',
            text: 'MIT rose to first [link 2], while Princeton fell.\n\n[image 1] Harvard held third.',
          },
          { headline: 'Blank', summary: 'Its text is empty.', text: '  ' },
        ],
      }),
    ).toEqual({
      line: null,
      summary: 'One story.',
      stories: [
        {
          headline: 'MIT',
          summary: 'MIT is first.',
          text: 'MIT rose to first, while Princeton fell.\n\nHarvard held third.',
          topic: 'Other',
        },
        { headline: 'Blank', summary: 'Its text is empty.', topic: 'Other' },
      ],
    });
  });

  it('never stores an address the model wrote itself', () => {
    expect(
      readDigest({
        summary: 'One story.',
        stories: [
          {
            headline: 'Typed',
            summary: 'Wrote a URL.',
            link: 'https://evil.example',
            image: 'https://evil.example/pixel.gif',
          },
        ],
      }),
    ).toEqual({
      line: null,
      summary: 'One story.',
      stories: [{ headline: 'Typed', summary: 'Wrote a URL.', topic: 'Other' }],
    });
  });

  it('keeps a topic from the list, matched without regard to case', () => {
    expect(
      readDigest({
        summary: 'Two stories.',
        stories: [
          { headline: 'Rates', summary: 'Rates held.', topic: 'Markets' },
          { headline: 'Chips', summary: 'A new chip.', topic: '  SCIENCE ' },
        ],
      }),
    ).toEqual({
      line: null,
      summary: 'Two stories.',
      stories: [
        { headline: 'Rates', summary: 'Rates held.', topic: 'Markets' },
        { headline: 'Chips', summary: 'A new chip.', topic: 'Science' },
      ],
    });
  });

  it('gives a story with no topic, or one not on the list, the topic Other', () => {
    expect(
      readDigest({
        summary: 'Three stories.',
        stories: [
          { headline: 'Untagged', summary: 'The reply gave no topic.' },
          {
            headline: 'Invented',
            summary: 'The reply made one up.',
            topic: 'Artificial intelligence',
          },
          { headline: 'Not text', summary: 'The reply sent a number.', topic: 4 },
        ],
      }),
    ).toEqual({
      line: null,
      summary: 'Three stories.',
      stories: [
        { headline: 'Untagged', summary: 'The reply gave no topic.', topic: 'Other' },
        { headline: 'Invented', summary: 'The reply made one up.', topic: 'Other' },
        { headline: 'Not text', summary: 'The reply sent a number.', topic: 'Other' },
      ],
    });
  });

  it('reads a missing story list as none', () => {
    expect(readDigest({ summary: 'Fine.' })).toEqual({ line: null, summary: 'Fine.', stories: [] });
  });
});

describe('reading the line', () => {
  it('reads a blank or missing line as none', () => {
    expect(readLine(undefined)).toBeNull();
    expect(readLine('   ')).toBeNull();
    expect(readLine(42)).toBeNull();
  });

  it('keeps a line within the limit as written, on one line', () => {
    expect(readLine('  Rates hold;\n oil slides ')).toBe('Rates hold; oil slides');
  });

  it('cuts a long line at a word and marks the cut', () => {
    const long = 'The Fed holds rates, oil slides on supply news, and three startups raise money this week in Europe';
    const line = readLine(long);
    expect(long.length).toBeGreaterThan(LINE_CHARS);
    expect(line).toBe('The Fed holds rates, oil slides on supply news, and three startups raise money this week…');
    expect(line!.length).toBeLessThanOrEqual(LINE_CHARS);
  });
});

describe('the Local topic (note 552a9407)', () => {
  const localReport = reported({
    line: 'City hall.',
    summary: 'A city story.',
    stories: [{ headline: 'Mayor', summary: 'The mayor spoke.', topic: 'Local' }],
  });
  const source = { subject: 'Today', textBody: 'The mayor spoke.', htmlBody: null };

  it('names the reader\'s area to the model and keeps Local', async () => {
    const haiku = model(localReport);
    const digest = await writeDigest(source, { client: haiku.client, localArea: 'NYC' });
    const message = haiku.create.mock.calls[0][0].messages[0].content as string;
    expect(message.startsWith("Reader's local area: NYC\n")).toBe(true);
    expect(digest.stories[0].topic).toBe('Local');
  });

  it('reads Local as Other when no area is set', async () => {
    const haiku = model(localReport);
    const digest = await writeDigest(source, { client: haiku.client });
    const message = haiku.create.mock.calls[0][0].messages[0].content as string;
    expect(message).not.toContain('local area');
    expect(digest.stories[0].topic).toBe('Other');
  });
});
