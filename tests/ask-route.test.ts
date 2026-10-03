/**
 * The route the Ask Dash sheet asks through (plan #1438): the person from the
 * session, the question checked as the action checks it, and each lookup
 * written to the stream the moment it starts, before the answer is done. The
 * answer itself is askDashInRequest, covered through askDash in
 * lib/dash/ask.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AskLookupEvent } from '@/lib/dash/ask';
import { readAskStream, type LookupWire } from '@/lib/talk/lookups';

const session = vi.fn<() => Promise<{ id: string } | null>>();
const ask = vi.fn();

vi.mock('@/lib/auth/server', () => ({ getUser: () => session() }));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('@/lib/talk/ask-request', () => ({ askDashInRequest: (input: unknown) => ask(input) }));

const { POST } = await import('@/app/api/ask/route');

const REF = '11111111-1111-4111-8111-111111111111';

function post(body: unknown, type = 'application/json') {
  return POST(
    new Request('http://localhost/api/ask', {
      method: 'POST',
      headers: { 'content-type': type },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  session.mockReset();
  ask.mockReset();
});

describe('POST /api/ask', () => {
  it('refuses without a session, and reads nothing', async () => {
    session.mockResolvedValue(null);
    const res = await post({ question: 'hi' });
    expect(res.status).toBe(401);
    expect(ask).not.toHaveBeenCalled();
  });

  it('takes JSON only', async () => {
    session.mockResolvedValue({ id: 'u' });
    const res = await post({ question: 'hi' }, 'text/plain');
    expect(res.status).toBe(415);
    expect(ask).not.toHaveBeenCalled();
  });

  it('streams each lookup as it starts, before the answer, then the result', async () => {
    session.mockResolvedValue({ id: 'u' });
    let finish: () => void = () => {};
    ask.mockImplementation(async (input: { onLookup: (e: AskLookupEvent) => void }) => {
      input.onLookup({ phase: 'started', id: 't1', index: 0, name: 'job_applications', input: {} });
      input.onLookup({ phase: 'started', id: 'p1', index: 1, name: 'propose_todo', input: {} });
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      input.onLookup({
        phase: 'finished',
        id: 't1',
        index: 0,
        name: 'job_applications',
        input: {},
        ok: true,
        result: { ok: true, rows: [{}, {}] },
      });
      return { conversation: { ref: REF, title: 'q' }, turns: [], stop: 'answered' };
    });

    const res = await post({ question: 'Who have I heard nothing from?', conversationRef: REF, page: '/jobs' });
    expect(res.headers.get('content-type')).toContain('application/x-ndjson');
    const heard: LookupWire[] = [];
    const reading = readAskStream(res.body!, (l) => heard.push(l));

    // The answer is still being written, and the lookup is already there.
    await vi.waitFor(() => expect(heard).toHaveLength(1));
    expect(heard[0]).toMatchObject({ phase: 'started', name: 'job_applications' });

    finish();
    const result = await reading;
    expect(heard.map((l) => l.phase)).toEqual(['started', 'finished']);
    expect(heard[1].found).toBe(2);
    expect(result).toEqual({ conversation: { ref: REF, title: 'q' }, turns: [], stop: 'answered' });
    expect(ask.mock.calls[0][0]).toMatchObject({ question: 'Who have I heard nothing from?', conversationRef: REF, page: '/jobs' });
  });

  it('answers a conversation ref that is not one with the action\'s sentence', async () => {
    session.mockResolvedValue({ id: 'u' });
    const res = await post({ question: 'hi', conversationRef: 'nope' });
    const result = await readAskStream(res.body!, () => {});
    expect(result.error).toBe('That conversation is not there any more.');
    expect(ask).not.toHaveBeenCalled();
  });

  it('says it could not ask when the answer throws', async () => {
    session.mockResolvedValue({ id: 'u' });
    ask.mockRejectedValue(new Error('boom'));
    const result = await readAskStream((await post({ question: 'hi' })).body!, () => {});
    expect(result.error).toMatch(/could not be asked/);
  });
});
