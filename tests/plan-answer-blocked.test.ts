/**
 * Answering a blocked step, and the Accept button on a critic stop.
 *
 * An answer that takes a stopped screen as it is records the accept itself,
 * the same rounds and line as the button, so the work is merged rather than
 * left on its branch. Either way the step is sent to a session at once, and a
 * send that fails is said in the message without failing the answer.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { criticStopAsk } from '@/lib/plan/ui-check-stop';

type Row = Record<string, unknown>;

const OWNER = { id: 'owner-0000-0000-0000-000000000000', email: 'owner@example.com' };
const STEP = '11111111-2222-4333-8444-555555555555';

const ASK = criticStopAsk({
  owner: 1702,
  surfaces: [{ surface: 'goals-home', round: 3, fixes: 2, uploaded: false }],
});
const HISTORY = `Blocked 2026-10-10: ${ASK} The work is on branch claude/stop-1702.`;

const state = vi.hoisted(() => ({
  step: null as Record<string, unknown> | null,
  rounds: [] as Record<string, unknown>[],
  insertError: null as { message: string } | null,
  updates: [] as Record<string, unknown>[],
  inserts: [] as Record<string, unknown>[],
  turns: [] as Record<string, unknown>[],
  sends: [] as string[],
  send: { ok: true, number: 1702 } as Record<string, unknown>,
}));

function fakeClient() {
  const builder = (table: string) => {
    const self: Record<string, unknown> = {
      select: () => self,
      update: (patch: Row) => {
        state.updates.push(patch);
        return self;
      },
      insert: async (rows: Row[]) => {
        if (state.insertError) return { error: state.insertError };
        state.inserts.push(...rows);
        return { error: null };
      },
      eq: () => self,
      in: () => self,
      maybeSingle: async () => ({ data: state.step, error: null }),
      then: (resolve: (value: { data: unknown; error: null }) => unknown) =>
        resolve({ data: table === 'ui_checks' ? state.rounds : null, error: null }),
    };
    return self;
  };
  return {
    from: (table: string) => builder(table),
    rpc: async (name: string) =>
      name === 'app_owner'
        ? { data: { userId: OWNER.id, email: OWNER.email }, error: null }
        : { data: null, error: null },
  };
}

vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('@/lib/auth/server', () => ({
  createClient: async () => fakeClient(),
  getUser: async () => OWNER,
  requireUser: async () => OWNER,
}));
vi.mock('@/lib/thread/store', () => ({
  addThreadTurn: async (_db: unknown, turn: Row) => {
    state.turns.push(turn);
  },
}));
vi.mock('@/lib/plan/handover', () => ({
  handStepToClaude: async (input: { id: string }) => {
    state.sends.push(input.id);
    return state.send;
  },
  handFeatureToClaude: async () => ({ ok: false, error: 'not here' }),
}));

const { acceptCriticStop, answerBlockedStep } = await import('@/app/dev/plan/actions');

beforeEach(() => {
  state.step = { number: 1702, status: 'blocked', block_ask: ASK, comment: HISTORY };
  state.rounds = [{ surface: 'goals-home', round: 3, verdict: 'fix', fixes: [{}, {}], shots: [] }];
  state.insertError = null;
  state.updates = [];
  state.inserts = [];
  state.turns = [];
  state.sends = [];
  state.send = { ok: true, number: 1702 };
});

async function answer(words: string) {
  const form = new FormData();
  form.set('id', STEP);
  form.set('answer', words);
  return answerBlockedStep({}, form);
}

async function accept() {
  const form = new FormData();
  form.set('id', STEP);
  return acceptCriticStop({}, form);
}

describe('answerBlockedStep', () => {
  it('records an accept when the answer to a critic stop takes the screen as it is', async () => {
    const result = await answer('It’s probably fine');

    expect(result.error).toBeUndefined();
    expect(result.message).toBe(
      'Answered, and taken as an accept of the screen as it is. Sent #1702 to a session to merge the work and close the step.',
    );
    expect(state.inserts).toEqual([
      expect.objectContaining({
        step: 1702,
        surface: 'goals-home',
        round: 4,
        verdict: 'accepted',
        notes: 'Accepted by you on /dev/plan: It’s probably fine',
      }),
    ]);
    expect(state.turns).toEqual([expect.objectContaining({ author: 'me', body: 'It’s probably fine' })]);
    const patch = state.updates[0];
    expect(patch.status).toBe('not_started');
    expect(patch.block_ask).toBeNull();
    expect(patch.comment).toMatch(
      /Answered \d{4}-\d{2}-\d{2}: It’s probably fine\n\nAccepted \d{4}-\d{2}-\d{2}: the screen as it is, past the design critic's last round \(goals-home\)\. The work is on branch claude\/stop-1702: merge it and close the step\.$/,
    );
    expect(state.sends).toEqual([STEP]);
  });

  it('passes an answer that asks for a change to the session as words', async () => {
    const result = await answer('Make the header smaller');

    expect(result.message).toBe('Answered. Sent #1702 to a session.');
    expect(state.inserts).toEqual([]);
    expect(state.updates[0].comment).toMatch(/Answered \d{4}-\d{2}-\d{2}: Make the header smaller$/);
    expect(state.sends).toEqual([STEP]);
  });

  it('writes no accept on a block that is not a critic stop', async () => {
    state.step = { number: 1600, status: 'blocked', block_ask: 'Which colour?', comment: 'Blocked 2026-10-10: x' };
    state.send = { ok: true, number: 1600 };
    const result = await answer('yes');

    expect(result.message).toBe('Answered. Sent #1600 to a session.');
    expect(state.inserts).toEqual([]);
  });

  it('still answers when the accept cannot be written, and says so', async () => {
    state.insertError = { message: 'ui_checks is read-only' };
    const result = await answer('Accept');

    expect(result.error).toBeUndefined();
    expect(result.message).toContain('could not be recorded (ui_checks is read-only)');
    expect(state.updates[0].status).toBe('not_started');
    expect(state.updates[0].comment).not.toMatch(/Accepted \d/);
  });

  it('keeps the answer when the send fails, and says the clock tries again', async () => {
    state.send = { ok: false, error: 'PLAN_ROUTINE_ID is not set.' };
    const result = await answer('Make the header smaller');

    expect(result.error).toBeUndefined();
    expect(result.message).toBe(
      "Answered. It could not be sent to a session yet (PLAN_ROUTINE_ID is not set), so the plan's clock tries again within a few minutes.",
    );
    expect(state.updates[0].status).toBe('not_started');
  });

  it('refuses a step that is no longer blocked, and sends nothing', async () => {
    state.step = { number: 1702, status: 'not_started', block_ask: null, comment: null };
    const result = await answer('yes');
    expect(result.error).toBe('That step is no longer blocked.');
    expect(state.sends).toEqual([]);
  });
});

describe('acceptCriticStop', () => {
  it('writes the same rounds and line as an accepting answer, then sends the step', async () => {
    const result = await accept();

    expect(result.message).toBe(
      'Accepted. Sent #1702 to a session to merge the work and close the step.',
    );
    expect(state.inserts).toEqual([
      expect.objectContaining({ step: 1702, surface: 'goals-home', round: 4, verdict: 'accepted' }),
    ]);
    expect(state.updates[0].comment).toMatch(
      /\n\nAccepted \d{4}-\d{2}-\d{2}: .*The work is on branch claude\/stop-1702: merge it and close the step\.$/,
    );
    expect(state.turns).toEqual([]);
    expect(state.sends).toEqual([STEP]);
  });

  it('refuses when no round stopped the screen', async () => {
    state.rounds = [];
    const result = await accept();
    expect(result.error).toBe('No round on record stopped this screen, so there is nothing to accept.');
    expect(state.updates).toEqual([]);
    expect(state.sends).toEqual([]);
  });
});
