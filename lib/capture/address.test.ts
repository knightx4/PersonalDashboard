import { describe, expect, it, vi } from 'vitest';
import {
  answerCapture,
  CAPTURE_REQUEST_MAX_BYTES,
  captureSentence,
  type CaptureAccount,
  type CaptureAddressDeps,
} from './address';
import type { CaptureWriters } from './file';
import type { CapturePlace, CaptureSort } from './sort';
import type { CaptureTokenCheck } from './tokens';

/** The capture address (plan #1706): each refusal, and one filing per place. */

const TOKEN = `dash_${'a'.repeat(43)}`;
const USER = '00000000-0000-4000-8000-000000000001';
const ROLE = { id: '00000000-0000-4000-8000-0000000000a1', title: 'Product Analyst', company: 'Stripe' };
const GOAL = { id: '00000000-0000-4000-8000-0000000000b1', title: 'Run a half marathon' };

function writers(): CaptureWriters & { [K in keyof CaptureWriters]: ReturnType<typeof vi.fn> } {
  return {
    todo: vi.fn(async () => ({ id: 'task-1' })),
    goals: vi.fn(async () => ({
      captureId: 'cap-1',
      filed: [
        {
          kind: 'progress' as const,
          entry_id: 'e1',
          item_id: GOAL.id,
          step_title: null,
          goal_title: GOAL.title,
          text: 'ran 10k',
          quantity: 10,
          unit: 'km',
          happened_on: '2026-10-09',
          undone_at: null,
        },
      ],
    })),
    jobs: vi.fn(async () => ({ ok: true as const, subjectRef: 'core.conversation_turns:n1' })),
    vault: vi.fn(async () => ({ ok: true as const, noteId: 'note-1', title: 'An idea', blobSha: 'sha1' })),
    record: vi.fn(async () => 'action-1'),
  } as never;
}

function sure(place: CapturePlace, extra: Partial<CaptureSort['parts'][number]> = {}): CaptureSort {
  return { parts: [{ place, text: 'x', goal: null, role: null, ...extra }], confidence: 0.95, sure: true };
}

function setup(options: {
  check?: CaptureTokenCheck | Error;
  places?: CapturePlace[];
  sort?: CaptureSort | null;
} = {}) {
  const w = writers();
  const sort = vi.fn(async (_sentence: string, among: readonly CapturePlace[]) =>
    among.length === 1 && among[0] === 'jobs' ? sure('jobs', { role: ROLE }) : (options.sort ?? null),
  );
  const account: CaptureAccount = {
    places: options.places ?? ['todo', 'goals', 'jobs', 'vault'],
    sort,
    writers: w,
  };
  const check = vi.fn(async (token: string | null): Promise<CaptureTokenCheck> => {
    if (!token) return { ok: false, status: 401, reason: 'missing', message: 'No capture token was sent.' };
    if (!/^dash_/.test(token)) return { ok: false, status: 401, reason: 'malformed', message: 'That is not a capture token.' };
    if (options.check instanceof Error) throw options.check;
    return options.check ?? { ok: true, userId: USER, tokenId: 'tok-1' };
  });
  const deps: CaptureAddressDeps = { check, account: vi.fn(async () => account) };
  return { deps, w, sort, check };
}

function post(body: unknown, token: string | null = TOKEN, contentLength: string | null = null) {
  return { token, contentLength, body: typeof body === 'string' ? body : JSON.stringify(body) };
}

describe('refusals', () => {
  it('answers 401 without a token, and with something that is not one, before reading the body', async () => {
    const { deps, w } = setup();
    const none = await answerCapture(post({ text: 'hi' }, null), deps);
    expect(none.status).toBe(401);
    expect(none.body).toMatchObject({ ok: false, error: 'missing' });
    const bad = await answerCapture(post('not json', 'abc'), deps);
    expect(bad.status).toBe(401);
    expect(bad.body).toMatchObject({ ok: false, error: 'malformed' });
    expect(w.todo).not.toHaveBeenCalled();
  });

  it('answers 401 for an unknown or revoked token, with the sentence the person hears', async () => {
    for (const reason of ['unknown', 'revoked'] as const) {
      const { deps, w } = setup({ check: { ok: false, status: 401, reason, message: `Token ${reason}.` } });
      const reply = await answerCapture(post({ text: 'buy milk' }), deps);
      expect(reply.status).toBe(401);
      expect(reply.body).toEqual({ ok: false, error: reason, spoken: `Token ${reason}.` });
      expect(w.todo).not.toHaveBeenCalled();
    }
  });

  it('answers 429 with Retry-After when the token is over its limit', async () => {
    const { deps, w } = setup({
      check: { ok: false, status: 429, reason: 'limited', retryAfterSeconds: 42, message: 'Too many captures.' },
    });
    const reply = await answerCapture(post({ text: 'buy milk' }), deps);
    expect(reply.status).toBe(429);
    expect(reply.headers['Retry-After']).toBe('42');
    expect(reply.body).toMatchObject({ ok: false, error: 'limited', spoken: 'Too many captures.' });
    expect(w.todo).not.toHaveBeenCalled();
  });

  it('answers 503 when the token cannot be checked', async () => {
    const { deps } = setup({ check: new Error('database down') });
    const reply = await answerCapture(post({ text: 'buy milk' }), deps);
    expect(reply.status).toBe(503);
    expect(reply.body).toMatchObject({ ok: false, error: 'unavailable' });
  });

  it('answers 413 for an over-long body, text or declared length, without counting it against the token', async () => {
    const { deps, check } = setup();
    const huge = await answerCapture(post({ text: 'a'.repeat(CAPTURE_REQUEST_MAX_BYTES) }), deps);
    expect(huge.status).toBe(413);
    const long = await answerCapture(post({ text: 'a'.repeat(4001) }), deps);
    expect(long.status).toBe(413);
    expect(long.body).toMatchObject({ ok: false, error: 'too_long' });
    const declared = await answerCapture(post({ text: 'hi' }, TOKEN, String(CAPTURE_REQUEST_MAX_BYTES + 1)), deps);
    expect(declared.status).toBe(413);
    expect(check).not.toHaveBeenCalled();
  });

  it('answers 400 for a body it cannot read, nothing to add, a bad link or an unknown place', async () => {
    const { deps } = setup();
    for (const body of ['not json', { text: '   ' }, { text: 'x', url: 'javascript:alert(1)' }, { text: 'x', place: 'shopping' }, { text: 5 }]) {
      const reply = await answerCapture(post(body), deps);
      expect(reply.status).toBe(400);
      expect(reply.body).toMatchObject({ ok: false, error: 'bad_request' });
    }
  });

  it('answers 422 for a place whose workspace is off', async () => {
    const { deps, w } = setup({ places: ['todo'] });
    const reply = await answerCapture(post({ text: 'an idea', place: 'vault' }), deps);
    expect(reply.status).toBe(422);
    expect(reply.body).toMatchObject({ ok: false, error: 'place_off' });
    expect(w.vault).not.toHaveBeenCalled();
  });

  it('answers 422 with the reason when nothing could be filed', async () => {
    const { deps, w } = setup();
    w.todo.mockResolvedValueOnce({ error: 'That title is too long.' });
    const reply = await answerCapture(post({ text: 'buy milk', place: 'todo' }), deps);
    expect(reply.status).toBe(422);
    expect(reply.body).toEqual({ ok: false, error: 'not_filed', spoken: 'That title is too long.' });
  });

  it('answers 500 when filing throws', async () => {
    const { deps, w } = setup();
    w.todo.mockRejectedValueOnce(new Error('boom'));
    const reply = await answerCapture(post({ text: 'buy milk', place: 'todo' }), deps);
    expect(reply.status).toBe(500);
    expect(reply.body).toMatchObject({ ok: false, error: 'unavailable' });
  });
});

describe('filing with a place', () => {
  it('files a todo for today, records it as a capture by Dash, and skips the sorter', async () => {
    const { deps, w, sort } = setup();
    const reply = await answerCapture(post({ text: 'renew the passport', place: 'Todo' }), deps);
    expect(reply.status).toBe(200);
    expect(w.todo).toHaveBeenCalledWith('renew the passport');
    expect(w.record).toHaveBeenCalledWith(
      expect.objectContaining({ surface: 'capture', kind: 'add_todo', subjectRef: 'todo.tasks:task-1', op: 'insert' }),
    );
    expect(sort).not.toHaveBeenCalled();
    expect(reply.body).toEqual({
      ok: true,
      spoken: 'Added to your todos for today.',
      filed: [{ place: 'todo', where: 'Todo · Today', href: '/todo', actionId: 'action-1' }],
      errors: [],
      unsure: false,
    });
  });

  it('files against their goals and names the goal', async () => {
    const { deps, w } = setup();
    const reply = await answerCapture(post({ text: 'ran 10k this morning', place: 'goals' }), deps);
    expect(reply.status).toBe(200);
    expect(w.goals).toHaveBeenCalledWith('ran 10k this morning');
    expect(reply.body).toMatchObject({ ok: true, spoken: `Logged against your goal ${GOAL.title}.` });
  });

  it('files a note on a job, asking the sorter which role among the jobs only', async () => {
    const { deps, w, sort } = setup();
    const reply = await answerCapture(post({ text: 'recruiter called back', place: 'jobs' }), deps);
    expect(reply.status).toBe(200);
    expect(sort).toHaveBeenCalledWith('recruiter called back', ['jobs']);
    expect(w.jobs).toHaveBeenCalledWith(ROLE.id, 'recruiter called back');
    expect(w.record).toHaveBeenCalledWith(expect.objectContaining({ surface: 'capture', kind: 'add_role_note' }));
    expect(reply.body).toMatchObject({ ok: true, spoken: 'Added a note on Product Analyst at Stripe.' });
  });

  it('keeps a note in the vault with what undoing it needs', async () => {
    const { deps, w } = setup();
    const reply = await answerCapture(post({ text: 'an idea about gardens', place: 'vault' }), deps);
    expect(reply.status).toBe(200);
    expect(w.vault).toHaveBeenCalledWith('an idea about gardens');
    expect(w.record).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'add_vault_note', undo: { vault_blob_sha: 'sha1' } }),
    );
    expect(reply.body).toMatchObject({ ok: true, spoken: "Kept in your vault's Inbox." });
  });

  it('files the link on its own line after the text, and a link alone as the sentence', async () => {
    const { deps, w } = setup();
    await answerCapture(post({ text: 'read this', url: 'https://example.com/a', place: 'todo' }), deps);
    expect(w.todo).toHaveBeenCalledWith('read this\nhttps://example.com/a');
    expect(captureSentence('', 'https://example.com/a')).toBe('https://example.com/a');
  });
});

describe('filing without a place', () => {
  it('files where a sure sort says', async () => {
    const { deps, w, sort } = setup({ sort: sure('goals', { text: 'ran 10k', goal: GOAL }) });
    const reply = await answerCapture(post({ text: 'ran 10k' }), deps);
    expect(sort).toHaveBeenCalledWith('ran 10k', ['todo', 'goals', 'jobs', 'vault']);
    expect(w.goals).toHaveBeenCalledWith('ran 10k');
    expect(reply.body).toMatchObject({ ok: true, unsure: false });
  });

  it('keeps it as a todo for today when Dash is not sure, and says so', async () => {
    const { deps, w } = setup({ sort: { ...sure('jobs'), confidence: 0.4, sure: false } });
    const reply = await answerCapture(post({ text: 'something vague' }), deps);
    expect(w.todo).toHaveBeenCalledWith('something vague');
    expect(w.jobs).not.toHaveBeenCalled();
    expect(reply.body).toMatchObject({
      ok: true,
      unsure: true,
      spoken: 'Dash was not sure where this goes, so it is a todo for today.',
    });
  });

  it('asks for a place when Dash is not sure and todos are off', async () => {
    const { deps } = setup({ places: ['goals', 'vault'], sort: null });
    const reply = await answerCapture(post({ text: 'something vague' }), deps);
    expect(reply.status).toBe(422);
    expect(reply.body).toMatchObject({ ok: false, error: 'not_filed' });
    expect((reply.body as { spoken: string }).spoken).toContain('goals or vault');
  });
});
