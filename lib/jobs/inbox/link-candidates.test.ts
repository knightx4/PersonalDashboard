import { beforeEach, describe, expect, it } from 'vitest';
import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import { findUnlinkedMessages } from './link-candidates';

/**
 * What the "possible matches" search asks the database for.
 *
 * The subject and the sender used to be matched from inside one `or`
 * expression. PostgREST reads a comma in one of those as the separator between
 * its sides, so a company called "Smith, Jones & Co" sent a filter that does
 * not parse and the box listed no mail at all. Two `ilike` reads now, merged
 * by id and put back in date order before the dismissed ones are dropped.
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

const ilikes: Array<[string, string]> = [];
const ors: string[] = [];
const limits: number[] = [];
let rows: { bySubject?: MessageRow[]; byFrom?: MessageRow[] } = {};
let dismissed: string[] = [];

/** A stand-in for the jobs client: the dismissals read and the two mail reads. */
function client(): AppSupabaseClient {
  return {
    from(table: string) {
      if (table === 'message_link_dismissals') {
        return {
          select: () => ({
            eq: () =>
              Promise.resolve({
                data: dismissed.map((id) => ({ message_id: id })),
                error: null,
              }),
          }),
        } as never;
      }

      let matched: MessageRow[] = [];
      const read = {
        select: () => read,
        eq: () => read,
        is: () => read,
        // Kept on the stub although nothing should call it: an `or` is what a
        // comma in the term broke, so one has to show up in the assertions
        // rather than pass unnoticed.
        or(expression: string) {
          ors.push(expression);
          return read;
        },
        ilike(column: string, pattern: string) {
          ilikes.push([column, pattern]);
          matched = (column === 'subject' ? rows.bySubject : rows.byFrom) ?? [];
          return read;
        },
        order: () => read,
        limit(count: number) {
          limits.push(count);
          return Promise.resolve({ data: matched, error: null });
        },
      };

      return read as never;
    },
  } as unknown as AppSupabaseClient;
}

function message(id: string, subject: string, receivedAt: string | null): MessageRow {
  return {
    id,
    subject,
    from_address: 'careers@example.com',
    received_at: receivedAt,
    classification: 'other',
    email_address: null,
    thread_id: null,
    provider_message_id: null,
  };
}

function search(term: string, limit?: number) {
  return findUnlinkedMessages(client(), 'user-1', { applicationId: 'app-1', term, limit });
}

describe('findUnlinkedMessages', () => {
  beforeEach(() => {
    ilikes.length = 0;
    ors.length = 0;
    limits.length = 0;
    rows = {};
    dismissed = [];
  });

  it('searches on a term with a comma in it', async () => {
    rows = { bySubject: [message('m1', 'Your application to Smith, Jones & Co', '2026-03-01')] };

    const found = await search('Smith, Jones');

    expect(found.map((row) => row.id)).toEqual(['m1']);
    expect(ors).toEqual([]);
    expect(ilikes).toEqual([
      ['subject', '%Smith, Jones%'],
      ['from_address', '%Smith, Jones%'],
    ]);
  });

  it('takes a typed % or _ as the character it is', async () => {
    await search('50%_off');

    expect(ilikes).toEqual([
      ['subject', '%50\\%\\_off%'],
      ['from_address', '%50\\%\\_off%'],
    ]);
  });

  it('merges the two reads by id, newest first', async () => {
    const both = message('m1', 'March', '2026-03-01');
    rows = {
      bySubject: [both, message('m2', 'January', '2026-01-01')],
      byFrom: [both, message('m3', 'February', '2026-02-01')],
    };

    const found = await search('acme');

    expect(found.map((row) => row.id)).toEqual(['m1', 'm3', 'm2']);
  });

  it('drops the dismissed ones and cuts the rest to the limit', async () => {
    rows = {
      bySubject: [
        message('m1', 'March', '2026-03-01'),
        message('m2', 'February', '2026-02-01'),
        message('m3', 'January', '2026-01-01'),
      ],
    };
    dismissed = ['m1'];

    const found = await search('acme', 1);

    expect(found.map((row) => row.id)).toEqual(['m2']);
    // Both reads take the same headroom over the limit, so dismissals cannot
    // empty the list.
    expect(limits).toEqual([26, 26]);
  });

  it('reads nothing for a term of one character', async () => {
    const found = await search('a');

    expect(found).toEqual([]);
    expect(ilikes).toEqual([]);
  });
});
