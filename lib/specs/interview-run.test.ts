import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SpecInterview } from './interviews';

/**
 * The interview's two moves (plan #1639) with the store faked: an answer is
 * kept only when a question waits for it, "draft it now" asks for the draft
 * instead of being kept, and nothing is asked when it is not Dash's move.
 */

const store = vi.hoisted(() => ({
  current: null as SpecInterview | null,
  addInterviewTurn: vi.fn(async () => 'turn-1'),
  requestInterviewDraft: vi.fn(async () => {}),
}));

vi.mock('./interviews', async (importOriginal) => {
  const real = await importOriginal<typeof import('./interviews')>();
  return {
    ...real,
    loadSpecInterview: vi.fn(async () => store.current),
    addInterviewTurn: store.addInterviewTurn,
    requestInterviewDraft: store.requestInterviewDraft,
  };
});

const { answerInterview, askInterviewQuestion } = await import('./interview-run');

function interview(turns: SpecInterview['turns'], extra: Partial<SpecInterview> = {}): SpecInterview {
  return {
    id: 'i1',
    module: 'todo',
    status: 'open',
    questionLimit: 12,
    draftRequestedAt: null,
    summary: null,
    visionReviewId: null,
    specChangeId: null,
    startedAt: '2026-10-07T09:00:00Z',
    finishedAt: null,
    turns,
    ...extra,
  };
}

const question = { id: 'q1', author: 'claude' as const, body: 'What is it for?', createdAt: '2026-10-07T09:01:00Z' };
const reply = { id: 'a1', author: 'me' as const, body: 'Errands.', createdAt: '2026-10-07T09:02:00Z' };
const client = {} as never;

beforeEach(() => {
  store.addInterviewTurn.mockClear();
  store.requestInterviewDraft.mockClear();
});

describe('answerInterview', () => {
  it('keeps the answer to the question waiting', async () => {
    store.current = interview([question]);
    await answerInterview(client, 'u1', 'i1', 'Errands and the weekly shop.');
    expect(store.addInterviewTurn).toHaveBeenCalledWith(client, 'u1', {
      interviewId: 'i1',
      author: 'me',
      body: 'Errands and the weekly shop.',
    });
    expect(store.requestInterviewDraft).not.toHaveBeenCalled();
  });

  it('asks for the draft on "draft it now" and keeps nothing', async () => {
    store.current = interview([question]);
    await answerInterview(client, 'u1', 'i1', 'Draft it now');
    expect(store.requestInterviewDraft).toHaveBeenCalledWith(client, 'u1', 'i1');
    expect(store.addInterviewTurn).not.toHaveBeenCalled();
  });

  it('refuses an answer when no question is waiting', async () => {
    store.current = interview([question, reply]);
    await expect(answerInterview(client, 'u1', 'i1', 'More.')).rejects.toThrow('no question waiting');
    expect(store.addInterviewTurn).not.toHaveBeenCalled();
  });
});

describe('askInterviewQuestion', () => {
  it('asks nothing once a draft has been asked for', async () => {
    store.current = interview([question, reply], { draftRequestedAt: '2026-10-07T09:03:00Z' });
    const asked = await askInterviewQuestion(client, 'u1', 'i1', { anthropicApiKey: 'k', today: '2026-10-07' });
    expect(asked).toEqual({ kind: 'stop', move: 'draft' });
    expect(store.addInterviewTurn).not.toHaveBeenCalled();
  });

  it('asks nothing while a question waits', async () => {
    store.current = interview([question]);
    const asked = await askInterviewQuestion(client, 'u1', 'i1', { anthropicApiKey: 'k', today: '2026-10-07' });
    expect(asked).toEqual({ kind: 'stop', move: 'answer' });
  });
});
