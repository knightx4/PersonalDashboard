import { describe, expect, it } from 'vitest';
import { findUnlinkedMessages } from '@/lib/jobs/inbox/link-candidates';
import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';

/**
 * What the "possible matches" search on a role page asks the database for.
 *
 * Stubbed rather than run against Postgres: the filters that go out are the
 * whole of what changed, and the stub has no `or` method, so a search that
 * went back to building an `or` expression would fail here rather than match
 * nothing on a term with a comma in it.
 */

type MessageRow = {
  id: string;
  subject: string | null;
  from_address: string | null;
  received_at: string | null;
  classification: string;
  email_address: string | null;
  thread_id: string | null;
  provider_message_id: string | null;
};

function message(id: string, receivedAt: string, subject = 'a subject'): MessageRow {
  return {
    id,
    subject,
    from_address: 'careers@acme.test',
    received_at: receivedAt,
    classification: 'other',
    email_address: null,
    thread_id: null,
    provider_message_id: null,
  };
}

type Rows = { subject?: MessageRow[]; from_address?: MessageRow[] };

function recordingClient(rows: Rows = {}, dismissed: string[] = []) {
  const filters: Array<[string, string]> = [];

  const supabase = {
    from(table: string) {
      if (table === 'message_link_dismissals') {
        return {
          select: () => ({
            eq: async () => ({ data: dismissed.map((id) => ({ message_id: id })), error: null }),
          }),
        } as never;
      }

      const read = {
        column: null as string | null,
        eq: () => read,
        is: () => read,
        ilike(column: string, pattern: string) {
          read.column = column;
          filters.push([column, pattern]);
          return read;
        },
        order: () => read,
        limit: async () => ({
          data: read.column === 'subject' ? (rows.subject ?? []) : (rows.from_address ?? []),
          error: null,
        }),
      };

      return { select: () => read } as never;
    },
  };

  return { client: supabase as unknown as AppSupabaseClient, filters };
}

describe('findUnlinkedMessages', () => {
  it('matches a term with a comma in it', async () => {
    const stub = recordingClient({
      subject: [message('m1', '2026-03-02T00:00:00Z', 'Acme, Inc — your application')],
    });

    const found = await findUnlinkedMessages(stub.client, 'user-1', {
      applicationId: 'app-1',
      term: 'Acme, Inc',
    });

    expect(found.map((row) => row.id)).toEqual(['m1']);
    // The comma is part of the pattern rather than the separator between two
    // conditions, which is what it was inside an `or`.
    expect(stub.filters).toEqual([
      ['subject', '%Acme, Inc%'],
      ['from_address', '%Acme, Inc%'],
    ]);
  });

  it('takes a typed % or _ as the character it is', async () => {
    const stub = recordingClient();

    await findUnlinkedMessages(stub.client, 'user-1', {
      applicationId: 'app-1',
      term: '50%_off',
    });

    expect(stub.filters).toEqual([
      ['subject', '%50\\%\\_off%'],
      ['from_address', '%50\\%\\_off%'],
    ]);
  });

  it('lists a message once, newest first, when both reads return it', async () => {
    const stub = recordingClient({
      subject: [message('m1', '2026-03-01T00:00:00Z'), message('m3', '2026-01-01T00:00:00Z')],
      from_address: [message('m2', '2026-02-01T00:00:00Z'), message('m1', '2026-03-01T00:00:00Z')],
    });

    const found = await findUnlinkedMessages(stub.client, 'user-1', {
      applicationId: 'app-1',
      term: 'acme',
    });

    expect(found.map((row) => row.id)).toEqual(['m1', 'm2', 'm3']);
  });

  it('leaves out a message already dismissed for this application', async () => {
    const stub = recordingClient(
      { subject: [message('m1', '2026-03-01T00:00:00Z'), message('m2', '2026-02-01T00:00:00Z')] },
      ['m1'],
    );

    const found = await findUnlinkedMessages(stub.client, 'user-1', {
      applicationId: 'app-1',
      term: 'acme',
    });

    expect(found.map((row) => row.id)).toEqual(['m2']);
  });

  it('reads nothing for a term under two characters', async () => {
    const stub = recordingClient();

    const found = await findUnlinkedMessages(stub.client, 'user-1', {
      applicationId: 'app-1',
      term: 'a',
    });

    expect(found).toEqual([]);
    expect(stub.filters).toEqual([]);
  });
});
