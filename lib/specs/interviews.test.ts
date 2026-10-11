import { describe, expect, it } from 'vitest';
import type { DevComment } from '@/lib/comments/load';
import {
  addInterviewTurn,
  clampQuestionLimit,
  DEFAULT_QUESTION_LIMIT,
  finishSpecInterview,
  interviewExchanges,
  interviewRef,
  isInterviewScope,
  loadSpecInterview,
  loadSpecInterviews,
  nextMove,
  requestInterviewDraft,
  startSpecInterview,
  type SpecInterview,
} from './interviews';

type Row = Record<string, unknown>;

/**
 * Enough of a Supabase client for these functions: spec_interviews as a list
 * of rows filtered by eq/is, the thread view filtered by ref and user, and
 * core.add_thread_turn appending to it. The one-open-per-workspace index is
 * enforced on insert, as the database does.
 */
function fakeClient() {
  const interviews: Row[] = [];
  const turns: Row[] = [];
  let clock = 0;
  const tick = () => new Date(Date.UTC(2026, 9, 7, 9, 0, clock++)).toISOString();

  function query(rows: Row[], table: string) {
    const filters: ((row: Row) => boolean)[] = [];
    let patch: Row | null = null;
    let inserted: Row | null = null;
    let insertError: { message: string } | null = null;
    let ascending: string | null = null;
    let descending: string | null = null;
    const run = () => {
      if (inserted || insertError) return { data: inserted, error: insertError };
      let found = rows.filter((row) => filters.every((f) => f(row)));
      if (patch) {
        for (const row of found) Object.assign(row, patch);
      }
      found = [...found];
      if (ascending) found.sort((a, b) => String(a[ascending!]).localeCompare(String(b[ascending!])));
      if (descending) found.sort((a, b) => String(b[descending!]).localeCompare(String(a[descending!])));
      return { data: found, error: null };
    };
    const builder = {
      select: () => builder,
      eq: (column: string, value: unknown) => {
        filters.push((row) => row[column] === value);
        return builder;
      },
      is: (column: string, value: unknown) => {
        filters.push((row) => (row[column] ?? null) === value);
        return builder;
      },
      in: (column: string, values: unknown[]) => {
        filters.push((row) => values.includes(row[column]));
        return builder;
      },
      order: (column: string, options: { ascending: boolean }) => {
        if (options.ascending) ascending = column;
        else descending = column;
        return builder;
      },
      insert: (row: Row) => {
        const clash = rows.some(
          (other) => other.user_id === row.user_id && other.module === row.module && other.status === 'open',
        );
        if (table === 'spec_interviews' && clash) {
          insertError = { message: 'duplicate key value violates unique constraint "spec_interviews_one_open_uq"' };
        } else {
          inserted = {
            id: `i${rows.length + 1}`,
            status: 'open',
            question_limit: DEFAULT_QUESTION_LIMIT,
            draft_requested_at: null,
            summary: null,
            vision_review_id: null,
            spec_change_id: null,
            started_at: tick(),
            finished_at: null,
            ...row,
          };
          rows.push(inserted);
        }
        return builder;
      },
      update: (fields: Row) => {
        patch = fields;
        return builder;
      },
      maybeSingle: async () => {
        const { data, error } = run();
        return { data: Array.isArray(data) ? (data[0] ?? null) : data, error };
      },
      single: async () => {
        const { data, error } = run();
        return { data: Array.isArray(data) ? data[0] : data, error };
      },
      then: (resolve: (value: unknown) => void) => resolve(run()),
    };
    return builder;
  }

  const client = {
    from: (table: string) => query(interviews, table),
    schema: () => ({
      from: () => query(turns, 'thread_turns'),
      rpc: async (_name: string, args: Row) => {
        const id = `t${turns.length + 1}`;
        turns.push({
          id,
          ref: args.p_ref,
          user_id: args.p_user_id,
          author: args.p_author,
          body: args.p_body,
          created_at: tick(),
        });
        return { data: id, error: null };
      },
    }),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { client: client as any, interviews, turns };
}

function turn(author: 'me' | 'claude', body: string, at: number): DevComment {
  return { id: `${author}-${at}`, author, body, createdAt: `2026-10-07T09:00:0${at}Z` };
}

describe('interviewExchanges', () => {
  it('pairs each question with the answers after it, in order', () => {
    const exchanges = interviewExchanges([
      turn('me', 'Before you start: keep it short.', 0),
      turn('claude', 'What is Learn for?', 1),
      turn('me', 'Reading papers.', 2),
      turn('me', 'And remembering them.', 3),
      turn('claude', 'When do you open it?', 4),
    ]);
    expect(exchanges.map((e) => [e.question.body, e.answer?.body ?? null])).toEqual([
      ['What is Learn for?', 'Reading papers.\n\nAnd remembering them.'],
      ['When do you open it?', null],
    ]);
  });
});

describe('nextMove', () => {
  const base: SpecInterview = {
    id: 'i1',
    module: 'learn',
    status: 'open',
    questionLimit: 2,
    draftRequestedAt: null,
    summary: null,
    visionReviewId: null,
    specChangeId: null,
    startedAt: '2026-10-07T09:00:00Z',
    finishedAt: null,
    turns: [],
  };

  it('is Dash asking, the person answering, then drafting at the limit', () => {
    expect(nextMove(base)).toBe('ask');
    expect(nextMove({ ...base, turns: [turn('claude', 'Q1', 1)] })).toBe('answer');
    expect(nextMove({ ...base, turns: [turn('claude', 'Q1', 1), turn('me', 'A1', 2)] })).toBe('ask');
    expect(
      nextMove({
        ...base,
        turns: [turn('claude', 'Q1', 1), turn('me', 'A1', 2), turn('claude', 'Q2', 3), turn('me', 'A2', 4)],
      }),
    ).toBe('draft');
  });

  it('drafts once asked to, and has nothing to do once finished', () => {
    expect(nextMove({ ...base, draftRequestedAt: '2026-10-07T09:05:00Z' })).toBe('draft');
    expect(nextMove({ ...base, status: 'drafted', finishedAt: '2026-10-07T09:06:00Z' })).toBeNull();
  });
});

describe('small rules', () => {
  it('holds interviews for a workspace or the app, and nothing else', () => {
    expect(isInterviewScope('learn')).toBe(true);
    expect(isInterviewScope('app')).toBe(true);
    expect(isInterviewScope('nowhere')).toBe(false);
  });

  it('keeps the limit a whole number in range', () => {
    expect(clampQuestionLimit(undefined)).toBe(12);
    expect(clampQuestionLimit(0)).toBe(1);
    expect(clampQuestionLimit(99)).toBe(30);
    expect(clampQuestionLimit(7.6)).toBe(8);
  });

  it('keys the thread by the row', () => {
    expect(interviewRef('abc')).toBe('public.spec_interviews:abc');
  });
});

describe('an interview, start to finish', () => {
  it('starts, keeps its questions and answers in order, and resumes', async () => {
    const { client } = fakeClient();
    const started = await startSpecInterview(client, 'u1', 'learn', { questionLimit: 5 });
    expect(started.resumed).toBe(false);
    expect(started.interview.questionLimit).toBe(5);
    const id = started.interview.id;

    await addInterviewTurn(client, 'u1', { interviewId: id, author: 'claude', body: 'What is Learn for?' });
    await addInterviewTurn(client, 'u1', { interviewId: id, author: 'me', body: 'Reading papers.' });
    await addInterviewTurn(client, 'u1', { interviewId: id, author: 'claude', body: 'When do you open it?' });

    const again = await startSpecInterview(client, 'u1', 'learn');
    expect(again.resumed).toBe(true);
    expect(again.interview.id).toBe(id);
    expect(nextMove(again.interview)).toBe('answer');

    const read = await loadSpecInterview(client, 'u1', id);
    expect(interviewExchanges(read!.turns).map((e) => [e.question.body, e.answer?.body ?? null])).toEqual([
      ['What is Learn for?', 'Reading papers.'],
      ['When do you open it?', null],
    ]);
  });

  it('is its owner’s only', async () => {
    const { client } = fakeClient();
    const { interview } = await startSpecInterview(client, 'u1', 'app');
    expect(await loadSpecInterview(client, 'u2', interview.id)).toBeNull();
    expect(await loadSpecInterviews(client, 'u2')).toEqual([]);
    await expect(
      addInterviewTurn(client, 'u2', { interviewId: interview.id, author: 'me', body: 'Hello' }),
    ).rejects.toThrow(/not one of yours/);
    await expect(finishSpecInterview(client, 'u2', interview.id, { status: 'abandoned' })).rejects.toThrow(
      /not one of yours/,
    );
  });

  it('takes no more turns once finished, and a new start begins afresh', async () => {
    const { client } = fakeClient();
    const { interview } = await startSpecInterview(client, 'u1', 'jobs');
    await requestInterviewDraft(client, 'u1', interview.id);
    expect(nextMove((await loadSpecInterview(client, 'u1', interview.id))!)).toBe('draft');

    await finishSpecInterview(client, 'u1', interview.id, {
      status: 'drafted',
      summary: 'They use Jobs to track applications.',
      visionReviewId: 'v1',
      specChangeId: 'c1',
    });
    const done = await loadSpecInterview(client, 'u1', interview.id);
    expect(done).toMatchObject({ status: 'drafted', visionReviewId: 'v1', specChangeId: 'c1' });
    expect(done!.finishedAt).not.toBeNull();
    await expect(
      addInterviewTurn(client, 'u1', { interviewId: interview.id, author: 'me', body: 'One more thing' }),
    ).rejects.toThrow(/has finished/);

    const fresh = await startSpecInterview(client, 'u1', 'jobs');
    expect(fresh.resumed).toBe(false);
    expect(fresh.interview.id).not.toBe(interview.id);
  });

  it('refuses a workspace that does not exist', async () => {
    const { client } = fakeClient();
    await expect(startSpecInterview(client, 'u1', 'nowhere')).rejects.toThrow(/no workspace/);
  });
});
