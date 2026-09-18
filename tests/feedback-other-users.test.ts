/**
 * Your notes and other people's, kept apart.
 *
 * Three accounts sign in to this app, and since migration 0086 the owner's
 * session can read every row of `feedback_items` rather than only its own. The
 * filter in the loader is therefore the whole of what keeps Outstanding and
 * Closed being *your* notes: widen the policy and forget the `eq`, and the
 * queue silently starts triaging somebody else's bug report with buttons that
 * the database will then refuse (#414).
 *
 * So both halves are asserted here against one table holding both accounts'
 * rows: the queue keeps only yours, and the Other users section keeps only
 * theirs, named by the address `feedback_filer_emails()` hands back.
 */
import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadFeedbackQueue, loadOtherUsersFeedback } from '@/lib/feedback/load';

type Row = Record<string, unknown>;

const OWNER = 'owner-id';
const OTHER = 'other-id';

function note(over: Row = {}): Row {
  return {
    id: 'note-1',
    user_id: OWNER,
    kind: 'bug',
    body: 'The total is wrong',
    page_path: '/shopping/inventory',
    status: 'open',
    priority: 2,
    resolution_note: null,
    commit_sha: null,
    created_at: '2026-09-01T10:00:00Z',
    completed_at: null,
    thread: [],
    ...over,
  };
}

/**
 * Enough of the query builder to answer these two reads -- and, unlike the
 * other stubs in this suite, it *applies* `eq` and `neq`, because which filter
 * the loader asks for is the thing under test.
 */
function stubClient(rows: Row[], emails: Row | null, rpcError = false) {
  const filters: string[] = [];

  const builder = () => {
    let out = [...rows];
    const self = {
      select: () => self,
      eq: (column: string, value: unknown) => {
        filters.push(`eq:${column}`);
        out = out.filter((row) => row[column] === value);
        return self;
      },
      neq: (column: string, value: unknown) => {
        filters.push(`neq:${column}`);
        out = out.filter((row) => row[column] !== value);
        return self;
      },
      order: () => self,
      limit: () => self,
      then: (resolve: (value: { data: Row[]; error: null }) => unknown) =>
        resolve({ data: out, error: null }),
    };
    return self;
  };

  const supabase = {
    from: builder,
    rpc: async () =>
      rpcError
        ? { data: null, error: { message: 'no such function' } }
        : { data: emails, error: null },
  } as unknown as SupabaseClient;

  return { supabase, filters };
}

const BOTH = [
  note(),
  note({ id: 'note-2', user_id: OWNER, status: 'done', completed_at: '2026-09-02T10:00:00Z' }),
  note({
    id: 'theirs-1',
    user_id: OTHER,
    kind: 'feature',
    body: 'A dark mode for the list',
    page_path: '/jobs/pipeline',
    created_at: '2026-09-03T10:00:00Z',
  }),
];

const EMAILS = {
  [OWNER]: 'selveyknight4@gmail.com',
  [OTHER]: 'averyjadek@gmail.com',
};

describe('loadFeedbackQueue', () => {
  it('keeps only your own rows, in Outstanding and in Closed', async () => {
    const { supabase, filters } = stubClient(BOTH, EMAILS);

    const queue = await loadFeedbackQueue(supabase, OWNER);

    expect(filters).toContain('eq:user_id');
    expect(queue.rows.map((row) => row.id)).toEqual(['note-1', 'note-2']);
    expect(queue.outstanding.map((row) => row.id)).toEqual(['note-1']);
    expect(queue.closed.map((row) => row.id)).toEqual(['note-2']);
    // The one that matters: nothing of somebody else's reaches the two
    // sections that carry a status select and a delete button.
    expect(queue.rows.some((row) => row.id === 'theirs-1')).toBe(false);
  });
});

describe('loadOtherUsersFeedback', () => {
  it('keeps only other accounts’ rows, each named by the account that filed it', async () => {
    const { supabase, filters } = stubClient(BOTH, EMAILS);

    const others = await loadOtherUsersFeedback(supabase, OWNER);

    expect(filters).toContain('neq:user_id');
    expect(others).toEqual([
      {
        id: 'theirs-1',
        email: 'averyjadek@gmail.com',
        kind: 'feature',
        body: 'A dark mode for the list',
        pagePath: '/jobs/pipeline',
        createdAt: '2026-09-03T10:00:00Z',
      },
    ]);
  });

  it('is empty when nobody else has filed anything, so the section is absent', async () => {
    const { supabase } = stubClient([note(), note({ id: 'note-2' })], EMAILS);

    await expect(loadOtherUsersFeedback(supabase, OWNER)).resolves.toEqual([]);
  });

  it('still lists the note when the address cannot be read', async () => {
    const { supabase } = stubClient(BOTH, null, true);

    const others = await loadOtherUsersFeedback(supabase, OWNER);

    expect(others).toHaveLength(1);
    expect(others[0].email).toBeNull();
    expect(others[0].body).toBe('A dark mode for the list');
  });
});
