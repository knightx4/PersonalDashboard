import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeSchemaDb, type FakeTables } from '../../tests/stubs/fake-schema-db';

vi.mock('server-only', () => ({}));

const called = vi.fn();
vi.mock('@/lib/you/board-start', () => ({
  callBoardMeeting: (input: unknown) => called(input),
}));

const { runYouWrite, YOU_WRITES } = await import('./you-writes');

/**
 * Ask Dash's ask_board (plan #2561.10): queues a question with its options,
 * context and lean, and convenes a meeting only when asked to.
 */

const ME = '00000000-0000-4000-8000-0000000000aa';
const ask = YOU_WRITES.find((entry) => entry.name === 'ask_board')!;

function tablesWithSeats(): FakeTables {
  return { 'you.board_questions': [], 'you.board_advisors': [] };
}
const env = (tables: FakeTables) => ({ userId: ME, you: fakeSchemaDb(tables)('you') });

beforeEach(() => {
  called.mockReset();
  called.mockResolvedValue({ started: true, meetingId: 'm1' });
});

describe('ask_board', () => {
  it('queues a question with its options, context and lean, and starts no meeting', async () => {
    const tables = tablesWithSeats();
    const result = await runYouWrite(ask, env(tables), {
      question: 'Take the 6 month contract?',
      options: ['Take it', 'Keep searching'],
      context: 'Pays 20% less; runway is 9 months.',
      lean: 'A',
    });
    if ('ok' in result) throw new Error(result.error);
    expect(result).toMatchObject({ kind: 'ask_board', op: 'insert', row: { href: '/you/board' } });
    expect(result.summary).toBe('Dash asked the board "Take the 6 month contract?", queued for the Sunday meeting.');
    expect(tables['you.board_questions']).toHaveLength(1);
    expect(tables['you.board_questions'][0]).toMatchObject({
      user_id: ME,
      status: 'queued',
      source: 'person',
      options: [
        { letter: 'A', text: 'Take it' },
        { letter: 'B', text: 'Keep searching' },
      ],
      context: 'Pays 20% less; runway is 9 months.',
      lean: 'A',
    });
    expect(called).not.toHaveBeenCalled();
  });

  it('convenes a meeting on the question only when told to', async () => {
    const tables = tablesWithSeats();
    const result = await runYouWrite(ask, env(tables), { question: 'Take the contract?', when: 'now' });
    if ('ok' in result) throw new Error(result.error);
    expect(result.summary).toContain('called a meeting on it now');
    expect(called).toHaveBeenCalledTimes(1);
    expect(called.mock.calls[0][0]).toMatchObject({
      userId: ME,
      decision: 'Take the contract?',
      questionIds: [(tables['you.board_questions'][0] as { id: string }).id],
    });
  });

  it('keeps the question queued and says why when a meeting cannot start', async () => {
    called.mockResolvedValue({ started: false, reason: 'running', error: 'x' });
    const tables = tablesWithSeats();
    const result = await runYouWrite(ask, env(tables), { question: 'Take the contract?', when: 'now' });
    if ('ok' in result) throw new Error(result.error);
    expect(result.summary).toContain('queued for the Sunday meeting (a meeting now did not start');
    expect(tables['you.board_questions']).toHaveLength(1);
  });

  it('refuses in the tab’s words: no question, one option, a bad when', async () => {
    const tables = tablesWithSeats();
    expect(await runYouWrite(ask, env(tables), {})).toEqual({ ok: false, error: 'Write the question first.' });
    expect(await runYouWrite(ask, env(tables), { question: 'Q?', options: ['Only one'] })).toEqual({
      ok: false,
      error: expect.stringContaining('at least two options'),
    });
    expect(await runYouWrite(ask, env(tables), { question: 'Q?', when: 'later' })).toEqual({
      ok: false,
      error: expect.stringContaining("'sunday' or 'now'"),
    });
    expect(tables['you.board_questions']).toHaveLength(0);
  });
});
