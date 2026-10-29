import { describe, expect, it } from 'vitest';
import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import { sourceMailByApplication } from './load';

/** A client whose inbox_messages query returns these rows, oldest first. */
function client(rows: Record<string, unknown>[]): AppSupabaseClient {
  const query = {
    select: () => query,
    in: () => query,
    order: () => Promise.resolve({ data: rows }),
  };
  return { from: () => query } as unknown as AppSupabaseClient;
}

describe('the email an inferred application came from (note d8d246b9)', () => {
  it('links each application to its earliest message in Gmail', async () => {
    const hrefs = await sourceMailByApplication(
      client([
        { email_account_id: 'acc', thread_id: 'aa1', provider_message_id: 'm1', resulting_application_id: 'app1' },
        { email_account_id: 'acc', thread_id: 'bb2', provider_message_id: 'm2', resulting_application_id: 'app1' },
      ]),
      ['acc'],
      new Map([['acc', 'me@example.com']]),
      ['app1', 'app2'],
    );
    expect(hrefs.get('app1')).toBe('https://mail.google.com/mail/?authuser=me%40example.com#all/aa1');
    expect(hrefs.has('app2')).toBe(false);
  });

  it('asks nothing when no inbox is connected', async () => {
    const hrefs = await sourceMailByApplication(client([]), [], new Map(), ['app1']);
    expect(hrefs.size).toBe(0);
  });
});
