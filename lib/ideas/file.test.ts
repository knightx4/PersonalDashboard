/**
 * Filing what the night noticed.
 *
 * The run happens every night and is shown the same board every night, so the
 * property that matters is that a thought only reaches the page once: not
 * again tomorrow, and not twice out of one run.
 */
import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fileNightIdeas, nightIdeaBody } from '@/lib/ideas/file';

type Row = Record<string, unknown>;

/**
 * Enough of the query builder for one read and the inserts after it. Filters
 * are ignored: the list is stubbed with exactly the rows the case is about.
 */
function stubClient(
  existing: ReadonlyArray<{ id: string; body: string }>,
  fails: { read?: string; insert?: string } = {},
) {
  const written: Row[] = [];
  const tables: string[] = [];
  let ids = 0;

  const read = {
    select: () => read,
    eq: () => read,
    is: () => read,
    order: () => read,
    then: (resolve: (value: { data: Row[] | null; error: { message: string } | null }) => unknown) =>
      resolve(
        fails.read
          ? { data: null, error: { message: fails.read } }
          : { data: existing.map((row) => ({ ...row })), error: null },
      ),
  };

  const insert = (row: Row) => {
    written.push(row);
    ids += 1;
    const inserted = {
      select: () => inserted,
      single: async () =>
        fails.insert
          ? { data: null, error: { message: fails.insert } }
          : { data: { id: `new-${ids}` }, error: null },
    };
    return inserted;
  };

  const table = { select: () => read, insert };
  const supabase = {
    from: (name: string) => {
      tables.push(name);
      return table;
    },
  } as unknown as SupabaseClient;

  return { supabase, written, tables };
}

const OPEN_QUESTION = 'Nobody has answered the import question, open three weeks';
const SAME_QUESTION_AGAIN = 'The import question nobody has answered has been open for three weeks';
const OTHER = 'Two open questions are holding up the same feature';

describe('fileNightIdeas', () => {
  it('writes what the night noticed as a suggestion on the ideas page', async () => {
    const { supabase, written } = stubClient([]);

    const filed = await fileNightIdeas(supabase, 'user-1', [
      { title: OPEN_QUESTION, detail: 'Answer it or drop it.' },
    ]);

    expect(filed).toBe(1);
    expect(written).toEqual([
      {
        user_id: 'user-1',
        body: `${OPEN_QUESTION}\n\nAnswer it or drop it.`,
        module: null,
        source: 'claude',
      },
    ]);
  });

  it('leaves out a suggestion that repeats an idea already on the page', async () => {
    const { supabase, written } = stubClient([{ id: 'filed-1', body: SAME_QUESTION_AGAIN }]);

    const filed = await fileNightIdeas(supabase, 'user-1', [
      { title: OPEN_QUESTION, detail: null },
      { title: OTHER, detail: null },
    ]);

    expect(filed).toBe(1);
    expect(written.map((row) => row.body)).toEqual([OTHER]);
  });

  it('files one of two suggestions that repeat each other', async () => {
    const { supabase, written } = stubClient([]);

    const filed = await fileNightIdeas(supabase, 'user-1', [
      { title: OPEN_QUESTION, detail: null },
      { title: SAME_QUESTION_AGAIN, detail: null },
    ]);

    expect(filed).toBe(1);
    expect(written.map((row) => row.body)).toEqual([OPEN_QUESTION]);
  });

  it('files nothing and reads nothing on a night with no suggestions', async () => {
    const { supabase, written, tables } = stubClient([{ id: 'filed-1', body: OTHER }]);

    await expect(fileNightIdeas(supabase, 'user-1', [])).resolves.toBe(0);

    expect(written).toEqual([]);
    expect(tables).toEqual([]);
  });

  /**
   * The count is what the morning summary prints, so it has to be the rows
   * that landed rather than the suggestions considered.
   */
  it('counts only what the database took', async () => {
    const { supabase } = stubClient([], { insert: 'body exceeds 4000 characters' });
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      fileNightIdeas(supabase, 'user-1', [{ title: OPEN_QUESTION, detail: null }]),
    ).resolves.toBe(0);

    quiet.mockRestore();
  });

  /**
   * Without the list there is nothing to compare against, and filing anyway
   * would put the whole night on the page again.
   */
  it('files nothing when the list cannot be read', async () => {
    const { supabase, written } = stubClient([], { read: 'connection lost' });

    await expect(
      fileNightIdeas(supabase, 'user-1', [{ title: OPEN_QUESTION, detail: null }]),
    ).rejects.toThrow('connection lost');

    expect(written).toEqual([]);
  });
});

describe('nightIdeaBody', () => {
  it('puts the line first and what to do about it under it', () => {
    expect(nightIdeaBody({ title: 'The question is open', detail: 'Answer it.' })).toBe(
      'The question is open\n\nAnswer it.',
    );
  });

  it('is the line alone when the run said nothing more', () => {
    expect(nightIdeaBody({ title: 'The question is open', detail: '  ' })).toBe(
      'The question is open',
    );
  });
});
