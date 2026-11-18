import { describe, expect, it } from 'vitest';
import type { AppRouteResult } from './app-route';
import {
  finishComment,
  nextFor,
  numbersLine,
  runAppRoutePolls,
  type AppRoutePoll,
  type AppRoutePollPorts,
  type PollFinish,
} from './app-route-polls';

/**
 * The background finish of run_app_route (plan #3070.3): each pass calls a
 * due poll's route once, puts it off, or finishes it with a comment on the
 * step or raise and a line in the chat it came from.
 */

const NOW = new Date('2026-11-08T12:20:00Z');

const poll = (over: Partial<AppRoutePoll> = {}): AppRoutePoll => ({
  id: 'poll-1',
  userId: 'owner',
  askedBy: 'bot:builder',
  path: '/api/cron/broker-wake-test',
  thenQuery: {},
  pollUntil: 'finished',
  everySeconds: 90,
  deadline: '2026-11-08T12:30:00Z',
  createdAt: '2026-11-08T12:00:00Z',
  calls: 13,
  postToRef: 'public.plan_items:11111111-1111-4111-8111-111111111111',
  postToLabel: '#2789',
  ...over,
});

const result = (body: unknown, over: Partial<AppRouteResult> = {}): AppRouteResult => ({
  runId: 'run-14',
  outcome: 'ok',
  httpStatus: 200,
  result: body,
  resultBytes: 40,
  error: null,
  ...over,
});

function ports(polls: AppRoutePoll[], answer: AppRouteResult) {
  const log = {
    runs: [] as unknown[],
    putOff: [] as unknown[],
    finished: [] as PollFinish[],
    comments: [] as { ref: string; body: string }[],
    said: [] as { id: string; text: string }[],
  };
  const value: AppRoutePollPorts = {
    claim: async () => polls,
    run: async (input) => {
      log.runs.push(input);
      return answer;
    },
    putOff: async (input) => {
      log.putOff.push(input);
    },
    finish: async (input) => {
      log.finished.push(input);
    },
    comment: async (input) => {
      log.comments.push(input);
    },
    say: async (input) => {
      log.said.push(input);
    },
  };
  return { value, log };
}

describe('the numbers line', () => {
  it('names every number and true/false two levels deep', () => {
    expect(numbersLine({ finished: true, delivered: 3, timing: { waited_seconds: 410 }, note: 'x' })).toBe(
      'finished true, delivered 3, timing.waited_seconds 410',
    );
    expect(numbersLine('not json')).toBe('');
  });
});

describe('what becomes of a poll after a call', () => {
  it('finishes when the field is true, fails a failed call, and waits out the busy limit', () => {
    expect(nextFor(poll(), result({ finished: true }), NOW)).toEqual({ kind: 'finish', status: 'done' });
    expect(nextFor(poll(), result(null, { outcome: 'failed', error: 'The route answered 500.' }), NOW)).toEqual({
      kind: 'finish',
      status: 'failed',
    });
    expect(nextFor(poll(), result(null, { outcome: 'refused', runId: null }), NOW)).toEqual({ kind: 'busy' });
  });

  it('puts the next call off, or times out when it would fall past the deadline', () => {
    expect(nextFor(poll(), result({ finished: false }), NOW)).toEqual({ kind: 'put_off', nextAt: '2026-11-08T12:21:30.000Z' });
    expect(nextFor(poll(), result({ finished: false }), new Date('2026-11-08T12:29:00Z'))).toEqual({
      kind: 'finish',
      status: 'timed_out',
    });
  });
});

describe('a pass', () => {
  it('finishes a poll whose field came back true: the JSON on the step, and a line in the chat', async () => {
    const { value, log } = ports([poll()], result({ finished: true, delivered: 3, waited_seconds: 410 }));
    const summary = await runAppRoutePolls(value, () => NOW);
    expect(log.runs).toEqual([{ path: '/api/cron/broker-wake-test', query: {}, askedBy: 'bot:builder' }]);
    expect(log.finished).toEqual([
      {
        id: 'poll-1',
        status: 'done',
        calls: 14,
        lastRunId: 'run-14',
        result: { finished: true, delivered: 3, waited_seconds: 410 },
        error: null,
      },
    ]);
    expect(log.comments[0].ref).toBe('public.plan_items:11111111-1111-4111-8111-111111111111');
    expect(log.comments[0].body).toContain('Numbers: finished true, delivered 3, waited_seconds 410.');
    expect(log.comments[0].body).toContain('"delivered": 3');
    expect(log.said[0].text).toBe(
      'GET /api/cron/broker-wake-test finished: finished is true, after 14 calls over 20 minutes. finished true, delivered 3, waited_seconds 410. The full result is on #2789.',
    );
    expect(summary.outcomes).toEqual([{ id: 'poll-1', kind: 'done', posted: true, said: true }]);
  });

  it('puts off a poll that is not done, posting nothing', async () => {
    const { value, log } = ports([poll()], result({ finished: false }));
    await runAppRoutePolls(value, () => NOW);
    expect(log.putOff).toEqual([
      { id: 'poll-1', calls: 14, lastRunId: 'run-14', result: { finished: false }, nextAt: '2026-11-08T12:21:30.000Z' },
    ]);
    expect(log.finished).toHaveLength(0);
    expect(log.comments).toHaveLength(0);
    expect(log.said).toHaveLength(0);
  });

  it('still says the finish in the chat when there is no step to comment on', async () => {
    const { value, log } = ports([poll({ postToRef: null, postToLabel: null })], result({ finished: false }));
    await runAppRoutePolls(value, () => new Date('2026-11-08T12:29:30Z'));
    expect(log.finished[0].status).toBe('timed_out');
    expect(log.comments).toHaveLength(0);
    expect(log.said[0].text).toMatch(/ran out of time before finished was true/);
  });

  it('counts a call refused for the busy limit as no call, and tries again soon', async () => {
    const { value, log } = ports([poll()], result(null, { outcome: 'refused', runId: null, error: '3 runs are already going' }));
    const summary = await runAppRoutePolls(value, () => NOW);
    expect(log.putOff).toEqual([{ id: 'poll-1', calls: 13, lastRunId: null, result: undefined, nextAt: '2026-11-08T12:21:00.000Z' }]);
    expect(summary.outcomes[0].kind).toBe('busy');
  });
});

describe('the comment', () => {
  it('cuts a long result', () => {
    const body = finishComment(
      poll(),
      { id: 'poll-1', status: 'done', calls: 2, lastRunId: null, result: { text: 'x'.repeat(10_000) }, error: null },
      NOW,
    );
    expect(body.length).toBeLessThan(7000);
    expect(body).toContain('cut at 6000 characters');
  });
});
