/**
 * The dev workspace's server actions, posted by an account that is not the
 * owner.
 *
 * #416 put the wall in `app/dev/layout.tsx`, and a layout is the whole of the
 * wall for what gets *drawn*. It is none of the wall for what can be *reached*:
 * a server action is an endpoint with an id, it is callable with a POST and
 * nothing about it needs the page it was written for to have rendered. Some of
 * these start a Claude routine, which costs money; others delete rows from the
 * plan. So each one begins with `requireOwner`, and this is the test that says
 * so for every file that has one.
 *
 * Two claims per action, and the second is the one that matters:
 *
 *   * it refuses -- `NotTheOwnerError`, thrown rather than returned, so a
 *     refusal cannot be mistaken for a form that did not validate; and
 *   * it wrote nothing and fired nothing. `from()` is the only way to the
 *     database and the routine starters are mocked to record, so "nothing
 *     happened" is a thing this can actually check rather than assume.
 *
 * The exception is `submitFeedback`. The header button posts it from every
 * page in the app, and filing a note stays open to every signed-in account --
 * so it is here too, asserted to still work.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const OWNER_ID = 'owner-0000-0000-0000-000000000000';
const OTHER_ID = 'other-0000-0000-0000-000000000000';
const SOME_UUID = '11111111-2222-4333-8444-555555555555';

const state = vi.hoisted(() => ({
  /** Every table an action reached for, in order. Empty is the assertion. */
  writes: [] as string[],
  /** Every routine an action tried to start. Empty is the assertion. */
  fired: [] as string[],
  /** Who is signed in. Null is signed out. */
  session: null as { id: string; email: string } | null,
}));

/**
 * A Supabase client that answers the owner check and records everything else.
 *
 * `rpc('app_owner')` is the real question `lib/dev/owner.ts` asks, answered
 * with the owner's id, so the module under test is the real one and only the
 * database is fake. Any other touch of the database goes through `from()`, and
 * that is what gets counted.
 */
function fakeClient() {
  const builder: Record<string, unknown> = {};
  const self = () => builder;
  for (const key of [
    'select',
    'insert',
    'update',
    'upsert',
    'delete',
    'eq',
    'neq',
    'in',
    'is',
    'not',
    'or',
    'gte',
    'lte',
    'order',
    'limit',
    'range',
  ]) {
    builder[key] = self;
  }
  builder.single = async () => ({ data: null, error: null });
  builder.maybeSingle = async () => ({ data: null, error: null });
  builder.then = (resolve: (value: unknown) => unknown) =>
    resolve({ data: null, error: null, count: 0 });

  return {
    from(table: string) {
      state.writes.push(table);
      return builder;
    },
    rpc: async (name: string) =>
      name === 'app_owner'
        ? { data: { userId: OWNER_ID, email: 'owner@example.com' }, error: null }
        : { data: null, error: null },
  };
}

vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

vi.mock('@/lib/auth/server', () => ({
  createClient: async () => fakeClient(),
  getUser: async () => state.session,
  requireUser: async () => {
    if (!state.session) throw new Error('unauthenticated');
    return state.session;
  },
}));

// Everything that costs money or wakes a session, recorded rather than run.
vi.mock('@/lib/plan/runs', () => ({
  startRoutineRun: async () => {
    state.fired.push('routine');
    return { ok: true, detail: 'started' };
  },
  reshapeUnderway: async () => null,
}));

vi.mock('@/lib/plan/handover', () => ({
  handStepToClaude: async () => {
    state.fired.push('step');
    return { ok: true, changed: false, number: 1, beneath: 0, detail: 'sent' };
  },
  handFeatureToClaude: async () => {
    state.fired.push('feature');
    return { ok: true, changed: false, number: 1, beneath: 0, detail: 'sent' };
  },
}));

vi.mock('@/lib/comments/ask', () => ({
  askDash: async () => {
    state.fired.push('ask');
    return { ok: true, message: 'asked' };
  },
}));

vi.mock('@/lib/raised/pickup', () => ({
  pickUpRaise: async () => {
    state.fired.push('pickup');
    return { ok: true, message: 'picked up' };
  },
}));

vi.mock('@/lib/comments/act', () => ({
  carryOut: async () => {
    state.fired.push('act');
    return { ok: true, said: 'done' };
  },
}));

vi.mock('@/lib/feedback/routine', () => ({
  notesRoutine: () => ({ id: 'r', token: 't' }),
  planRoutine: () => ({ id: 'r', token: 't' }),
  reviewRoutine: () => ({ id: 'r', token: 't' }),
}));

// The submit code the header panel carries. Answered rather than always-yes,
// because the code is now half of what `submitFeedback` decides: the owner is
// still asked for it and nobody else is. Every locked action below sends the
// right one, so a refusal there is never the code's refusal wearing the owner
// check's clothes.
vi.mock('@/lib/feedback/code', () => ({
  codeMatches: (given: string) => given === 'right',
}));

const { NotTheOwnerError } = await import('@/lib/dev/owner');
const bugs = await import('@/app/dev/bugs/actions');
const comments = await import('@/app/dev/comment-actions');
const ideas = await import('@/app/dev/ideas/actions');
const plan = await import('@/app/dev/plan/actions');
const raised = await import('@/app/dev/raised/actions');
const surfaces = await import('@/app/dev/surfaces/actions');
const review = await import('@/app/dev/ui/review/actions');

type Action = (prev: Record<string, never>, form: FormData) => Promise<unknown>;

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

/** One action from each file under app/dev, named by where it lives. */
const LOCKED: ReadonlyArray<{ file: string; name: string; run: () => Promise<unknown> }> = [
  {
    file: 'app/dev/bugs/actions.ts',
    name: 'deleteFeedback',
    run: () => (bugs.deleteFeedback as Action)({}, form({ id: SOME_UUID })),
  },
  {
    file: 'app/dev/bugs/actions.ts',
    name: 'runFeatureRoutine',
    run: () => (bugs.runFeatureRoutine as Action)({}, form({})),
  },
  {
    file: 'app/dev/comment-actions.ts',
    name: 'addComment',
    run: () =>
      (comments.addComment as Action)({}, form({ target: 'raise', id: SOME_UUID, body: 'yes' })),
  },
  {
    file: 'app/dev/ideas/actions.ts',
    name: 'submitIdea',
    run: () =>
      (ideas.submitIdea as Action)({}, form({ body: 'an idea', module: '', code: 'right' })),
  },
  {
    file: 'app/dev/ideas/actions.ts',
    name: 'shapeIdea',
    run: () => (ideas.shapeIdea as Action)({}, form({ id: SOME_UUID })),
  },
  {
    file: 'app/dev/plan/actions.ts',
    name: 'deletePlanItem',
    run: () => (plan.deletePlanItem as Action)({}, form({ id: SOME_UUID })),
  },
  {
    file: 'app/dev/plan/actions.ts',
    name: 'sendPlanItemToClaude',
    run: () => (plan.sendPlanItemToClaude as Action)({}, form({ id: SOME_UUID })),
  },
  {
    file: 'app/dev/raised/actions.ts',
    name: 'decideRaise',
    run: () => (raised.decideRaise as Action)({}, form({ id: SOME_UUID, answer: 'yes' })),
  },
  {
    file: 'app/dev/surfaces/actions.ts',
    name: 'noteOnSurface',
    run: () =>
      (surfaces.noteOnSurface as Action)({}, form({ surface: 'vault-tree', body: 'too tight' })),
  },
  {
    file: 'app/dev/ui/review/actions.ts',
    name: 'startUiReview',
    run: () => (review.startUiReview as Action)({}, form({ module: 'vault' })),
  },
];

beforeEach(() => {
  state.writes = [];
  state.fired = [];
  state.session = { id: OTHER_ID, email: 'someone@example.com' };
});

describe('a dev action posted by another account', () => {
  for (const { file, name, run } of LOCKED) {
    it(`${name} (${file}) refuses, writes nothing and fires nothing`, async () => {
      await expect(run()).rejects.toThrow(NotTheOwnerError);
      expect(state.writes).toEqual([]);
      expect(state.fired).toEqual([]);
    });
  }
});

describe('a dev action posted by nobody', () => {
  it('says unauthenticated rather than not the owner', async () => {
    state.session = null;
    await expect((plan.deletePlanItem as Action)({}, form({ id: SOME_UUID }))).rejects.toThrow(
      'unauthenticated',
    );
    expect(state.writes).toEqual([]);
  });
});

describe('the owner', () => {
  it('is let through to the work', async () => {
    state.session = { id: OWNER_ID, email: 'owner@example.com' };

    const result = await (plan.deletePlanItem as Action)({}, form({ id: SOME_UUID }));

    expect(result).toEqual({ message: expect.any(String) });
    expect(state.writes).toContain('plan_items');
  });
});

describe('filing a note', () => {
  /**
   * The one exception. Locking this would take the capture button in the
   * header away from the other two accounts, which is the opposite of what it
   * is for -- so it checks that somebody is signed in and nothing more.
   */
  it('still works for an account that is not the owner', async () => {
    const result = await (bugs.submitFeedback as Action)(
      {},
      form({ kind: 'bug', body: 'the page went blank', page_path: '/vault', code: 'right' }),
    );

    expect(result).toEqual({ message: 'Bug report saved.' });
    expect(state.writes).toEqual(['feedback_items']);
  });

  /**
   * And without a code, which is the real shape of it after #418: the panel
   * another account sees has no code box, so nothing is posted in that field.
   * A note filed with an empty one has to save, or the capture is locked to
   * the owner by the back door.
   */
  it('takes a note from another account with no code at all', async () => {
    const result = await (bugs.submitFeedback as Action)(
      {},
      form({ kind: 'feature', body: 'a button for it on the phone', page_path: '/todo' }),
    );

    expect(result).toEqual({ message: 'Feature request saved.' });
    expect(state.writes).toEqual(['feedback_items']);
  });

  /** The owner is still asked. Dropping that would weaken a working check. */
  it('still asks the owner for the code', async () => {
    state.session = { id: OWNER_ID, email: 'owner@example.com' };

    const result = await (bugs.submitFeedback as Action)(
      {},
      form({ kind: 'bug', body: 'the page went blank', code: 'wrong' }),
    );

    expect(result).toEqual({ error: 'That code is not right.' });
    expect(state.writes).toEqual([]);
  });

  it("files the owner's note when the code is right", async () => {
    state.session = { id: OWNER_ID, email: 'owner@example.com' };

    const result = await (bugs.submitFeedback as Action)(
      {},
      form({ kind: 'bug', body: 'the page went blank', code: 'right' }),
    );

    expect(result).toEqual({ message: 'Bug report saved.' });
    expect(state.writes).toEqual(['feedback_items']);
  });

  it('still refuses somebody who is not signed in at all', async () => {
    state.session = null;
    await expect(
      (bugs.submitFeedback as Action)({}, form({ kind: 'bug', body: 'the page went blank' })),
    ).rejects.toThrow('unauthenticated');
    expect(state.writes).toEqual([]);
  });
});
