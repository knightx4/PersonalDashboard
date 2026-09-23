import { describe, expect, it } from 'vitest';

import type { NewsSupabaseClient } from '@/lib/news/db/schema-name';
import { loadIssue, loadIssues } from './load';

const BASE = {
  id: 'i1',
  sender_id: 's1',
  subject: 'Weekly',
  received_at: '2026-09-23T08:00:00Z',
  read_at: null,
  text_body: 'hello',
  html_body: null,
  unsubscribe_url: null,
  unsubscribe_email: null,
  unsubscribe_sent_at: null,
  summary: null,
  stories: null,
  digest_error: null,
};

/** A client whose issue read returns `issue` and whose sender read returns nothing. */
function clientReturning(issue: Record<string, unknown>): NewsSupabaseClient {
  return {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: table === 'issues' ? issue : null, error: null }),
        }),
      }),
    }),
  } as unknown as NewsSupabaseClient;
}

describe('loadIssue', () => {
  it('returns the summary and stories of a summarised issue', async () => {
    const issue = await loadIssue(
      clientReturning({
        ...BASE,
        summary: 'Two stories this week.',
        stories: [{ headline: 'Rates held', summary: 'The bank kept rates.', link: 'https://example.com/a' }],
        digested_at: '2026-09-23T08:01:00Z',
      }),
      'i1',
    );
    expect(issue?.digest).toEqual({
      summary: 'Two stories this week.',
      stories: [{ headline: 'Rates held', summary: 'The bank kept rates.', link: 'https://example.com/a' }],
    });
    expect(issue?.digestError).toBeNull();
  });

  it('returns no digest for an issue not yet summarised', async () => {
    const issue = await loadIssue(clientReturning(BASE), 'i1');
    expect(issue?.digest).toBeNull();
    expect(issue?.digestError).toBeNull();
  });

  it('returns the error for an issue the model could not read', async () => {
    const issue = await loadIssue(
      clientReturning({ ...BASE, digest_error: 'the model call timed out' }),
      'i1',
    );
    expect(issue?.digest).toBeNull();
    expect(issue?.digestError).toBe('the model call timed out');
  });
});

/** A client whose list read returns `rows`, recording the columns it asked for. */
function listClient(rows: Record<string, unknown>[], asked: string[] = []): NewsSupabaseClient {
  const query = {
    contains: () => query,
    order: () => query,
    limit: async () => ({ data: rows, error: null }),
  };
  return {
    from: () => ({
      select: (columns: string) => {
        asked.push(columns);
        return query;
      },
    }),
  } as unknown as NewsSupabaseClient;
}

const LIST_ROW = {
  id: 'i1',
  sender_id: 's1',
  subject: 'Weekly',
  received_at: '2026-09-23T08:00:00Z',
  read_at: null,
};

describe('loadIssues', () => {
  it('reads the summary line and carries it on the issue', async () => {
    const asked: string[] = [];
    const [issue] = await loadIssues(
      listClient([{ ...LIST_ROW, summary_line: 'Rates held and oil fell.' }], asked),
    );
    expect(asked[0]).toContain('summary_line');
    expect(issue.summaryLine).toBe('Rates held and oil fell.');
  });

  it('gives an issue without a summary line no line', async () => {
    const [issue] = await loadIssues(listClient([{ ...LIST_ROW, summary_line: null }]));
    expect(issue.summaryLine).toBeNull();
  });
});
