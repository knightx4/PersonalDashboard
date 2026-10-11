/**
 * The backstop for answered steps no session was sent to: which steps it
 * finds (`unactedAnswers`, pure), and how the tick sends them
 * (`sendUnactedAnswers`, over ports). The properties that matter are that an
 * answer is never left unread and that one answer is never sent twice.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  backstopSentLine,
  historyLines,
  unactedAnswers,
  type AnswerRun,
  type AnswerStep,
} from '@/lib/plan/unacted-answers';
import { sendUnactedAnswers, type AnswerPorts } from '@/inngest/dev/answered';

function step(over: Partial<AnswerStep> & { id: string }): AnswerStep {
  return {
    number: 1600,
    status: 'not_started',
    parentId: null,
    comment: 'Blocked 2026-10-07: five pages wait for you.\n\nAnswered 2026-10-07: yes',
    turns: [],
    acceptedAt: [],
    ...over,
  };
}

const run = (planItemId: string, createdAt: string): AnswerRun => ({ planItemId, createdAt });

describe('historyLines', () => {
  it('reads the dated lines and skips the rest', () => {
    const lines = historyLines(
      'Added by session cse_01 on 2026-10-04.\n\nBlocked 2026-10-07: pages.\n\nSent back 2026-10-08 from the x pictures: no.\n\nAnswered 2026-10-09: It’s fine',
    );
    expect(lines.map((line) => [line.word, line.date])).toEqual([
      ['Blocked', '2026-10-07'],
      ['Sent back', '2026-10-08'],
      ['Answered', '2026-10-09'],
    ]);
    expect(lines[2].text).toBe('It’s fine');
  });
});

describe('unactedAnswers', () => {
  it('finds a step answered after its block with no run since', () => {
    expect(unactedAnswers([step({ id: 'a' })], [])).toEqual([
      { id: 'a', number: 1600, date: '2026-10-07', answeredAt: null },
    ]);
  });

  it('finds an Accepted line the same way', () => {
    const comment =
      "Blocked 2026-10-10: The design critic did not pass #1702's screen.\n\nAccepted 2026-10-11: the screen as it is.";
    expect(unactedAnswers([step({ id: 'a', comment })], [])).toHaveLength(1);
  });

  it('leaves a step whose newest line is not the answer', () => {
    const comment =
      'Blocked 2026-10-08: built on a branch.\n\nAnswered 2026-10-11: Dash should settle this.\n\nNext 2026-10-11: bring it onto main.';
    expect(unactedAnswers([step({ id: 'a', comment })], [])).toEqual([]);
    const blockedAgain = 'Answered 2026-10-07: yes\n\nBlocked 2026-10-08: again.';
    expect(unactedAnswers([step({ id: 'b', comment: blockedAgain })], [])).toEqual([]);
  });

  it('leaves a step the backstop already sent, by its own line', () => {
    const comment = `Blocked 2026-10-07: x.\n\nAnswered 2026-10-07: yes\n\n${backstopSentLine('2026-10-11')}`;
    expect(unactedAnswers([step({ id: 'a', comment })], [])).toEqual([]);
  });

  it('leaves a step with no block before the answer', () => {
    expect(unactedAnswers([step({ id: 'a', comment: 'Answered 2026-10-07: yes' })], [])).toEqual([]);
  });

  it('leaves steps that are not waiting to start', () => {
    const steps = ['in_progress', 'done', 'dropped', 'blocked', 'proposed'].map((status, i) =>
      step({ id: `s${i}`, status }),
    );
    expect(unactedAnswers(steps, [])).toEqual([]);
  });

  it('counts a run on a later day as acting on the answer, and one on an earlier day as not', () => {
    expect(unactedAnswers([step({ id: 'a' })], [run('a', '2026-10-08T01:00:00Z')])).toEqual([]);
    expect(unactedAnswers([step({ id: 'a' })], [run('a', '2026-10-06T23:00:00Z')])).toHaveLength(1);
  });

  it('counts a run sent at the feature above it', () => {
    const steps = [step({ id: 'f', status: 'other', comment: null }), step({ id: 'a', parentId: 'f' })];
    expect(unactedAnswers(steps, [run('f', '2026-10-09T10:00:00Z')])).toEqual([]);
    expect(unactedAnswers(steps, [run('other', '2026-10-09T10:00:00Z')])).toHaveLength(1);
  });

  it('compares a same-day run with the time of the thread turn holding the answer', () => {
    const turns = [{ body: 'yes', createdAt: '2026-10-07T14:53:00Z' }];
    const answered = step({ id: 'a', turns });
    // Sent after the answer: acted on.
    expect(unactedAnswers([answered], [run('a', '2026-10-07T14:53:02Z')])).toEqual([]);
    // The morning's run, before the answer: not.
    expect(unactedAnswers([answered], [run('a', '2026-10-07T08:00:00Z')])).toEqual([
      { id: 'a', number: 1600, date: '2026-10-07', answeredAt: '2026-10-07T14:53:00Z' },
    ]);
  });

  it('reads the time of an accept from its accepted round', () => {
    const comment = 'Blocked 2026-10-11: stop.\n\nAccepted 2026-10-11: the screen as it is.';
    const accepted = step({ id: 'a', comment, acceptedAt: ['2026-10-11T12:00:00Z'] });
    expect(unactedAnswers([accepted], [run('a', '2026-10-11T12:00:01Z')])).toEqual([]);
    expect(unactedAnswers([accepted], [run('a', '2026-10-11T09:00:00Z')])).toHaveLength(1);
  });

  it('counts a same-day run as earlier when the answer has no time on record', () => {
    // Written by Dash or by hand: only the day is known, so the answer is sent.
    expect(unactedAnswers([step({ id: 'a' })], [run('a', '2026-10-07T20:00:00Z')])).toHaveLength(1);
  });

  it('ignores a turn whose words differ from the line', () => {
    const turns = [{ body: 'something else', createdAt: '2026-10-07T14:53:00Z' }];
    const [found] = unactedAnswers([step({ id: 'a', turns })], []);
    expect(found.answeredAt).toBeNull();
  });

  it('puts the oldest answer first', () => {
    const later = step({
      id: 'b',
      number: 1500,
      comment: 'Blocked 2026-10-09: x.\n\nAnswered 2026-10-10: ok',
    });
    expect(unactedAnswers([later, step({ id: 'a' })], []).map((one) => one.id)).toEqual(['a', 'b']);
  });
});

describe('sendUnactedAnswers', () => {
  function ports(over: Partial<AnswerPorts> = {}): AnswerPorts & {
    send: ReturnType<typeof vi.fn>;
    markSent: ReturnType<typeof vi.fn>;
  } {
    const base = {
      accounts: async () => ['u1'],
      paused: async () => false,
      running: async () => 0,
      load: async () => ({
        steps: [
          step({ id: 'a' }),
          step({ id: 'b', number: 1601, comment: 'Blocked 2026-10-08: x.\n\nAnswered 2026-10-08: ok' }),
        ],
        runs: [],
      }),
      send: vi.fn(async () => ({ ok: true as const })),
      markSent: vi.fn(async () => {}),
      ...over,
    };
    return base as never;
  }

  it('sends the oldest answer, one per account a tick, and writes its line', async () => {
    const p = ports();
    const out = await sendUnactedAnswers(p);
    expect(out.u1).toEqual({ act: 'sent', step: 1600, refused: [] });
    expect(p.send).toHaveBeenCalledTimes(1);
    expect(p.markSent).toHaveBeenCalledWith('u1', expect.objectContaining({ id: 'a' }));
  });

  it('tries the next step when the send refuses one', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: 'a session is live under #1599' })
      .mockResolvedValueOnce({ ok: true });
    const p = ports({ send });
    const out = await sendUnactedAnswers(p);
    expect(out.u1).toEqual({
      act: 'sent',
      step: 1601,
      refused: [{ number: 1600, error: 'a session is live under #1599' }],
    });
    expect(p.markSent).toHaveBeenCalledTimes(1);
  });

  it('writes no line for a step it could not send', async () => {
    const p = ports({ send: vi.fn(async () => ({ ok: false as const, error: 'no routine' })) });
    const out = await sendUnactedAnswers(p);
    expect(out.u1.act).toBe('none');
    expect(p.markSent).not.toHaveBeenCalled();
  });

  it('sends nothing while the runner is paused', async () => {
    const p = ports({ paused: async () => true });
    expect((await sendUnactedAnswers(p)).u1).toEqual({ act: 'paused' });
    expect(p.send).not.toHaveBeenCalled();
  });

  it('sends nothing while every slot is taken', async () => {
    const p = ports({ running: async () => 3 });
    expect((await sendUnactedAnswers(p)).u1).toEqual({ act: 'full', running: 3 });
    expect(p.send).not.toHaveBeenCalled();
  });

  it('still counts the send when its line could not be written', async () => {
    const p = ports({ markSent: vi.fn(async () => Promise.reject(new Error('write failed'))) });
    expect((await sendUnactedAnswers(p)).u1).toEqual({ act: 'sent', step: 1600, refused: [] });
  });

  it('carries on to the next account when one breaks', async () => {
    const p = ports({
      accounts: async () => ['u1', 'u2'],
      load: async (userId: string) => {
        if (userId === 'u1') throw new Error('plan unreadable');
        return { steps: [step({ id: 'c' })], runs: [] };
      },
    });
    const out = await sendUnactedAnswers(p);
    expect(out.u1).toEqual({ act: 'failed', error: 'plan unreadable' });
    expect(out.u2).toMatchObject({ act: 'sent' });
  });
});
