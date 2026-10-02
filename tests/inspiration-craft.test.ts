/**
 * Craft into a plan on the Inspiration tab (plan #1413).
 *
 * The filing and the guard against a second craft are pinned in
 * lib/dev/inspiration/craft.test.ts. This is the action around them: that a
 * filed takeaway is sent to the shape routine with the idea it became, that a
 * refused craft fires nothing, and that a routine that will not start still
 * says the idea was filed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const TAKEAWAY_ID = '11111111-2222-4333-8444-555555555555';
const IDEA_ID = '66666666-7777-4888-9999-000000000000';

const state = vi.hoisted(() => ({
  crafted: { ok: true, ideaId: '', matched: null } as
    | { ok: true; ideaId: string; matched: { id: string; body: string } | null }
    | { ok: false; error: string },
  shaped: [] as string[],
  shapeResult: {} as { error?: string; message?: string },
}));

vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('next/server', () => ({ after: () => {} }));
vi.mock('@/lib/auth/server', () => ({ createClient: async () => ({}) }));
vi.mock('@/lib/dev/owner', () => ({ requireOwner: async () => ({ id: 'owner' }) }));
vi.mock('@/lib/dev/inspiration/craft', async (original) => ({
  ...(await original<typeof import('@/lib/dev/inspiration/craft')>()),
  craftTakeaway: async () => state.crafted,
}));
vi.mock('@/app/dev/ideas/actions', () => ({
  shapeIdea: async (_prev: unknown, form: FormData) => {
    state.shaped.push(String(form.get('id')));
    return state.shapeResult;
  },
}));

const { craftTakeaway } = await import('@/app/dev/inspiration/actions');

function form(id: string): FormData {
  const data = new FormData();
  data.set('id', id);
  return data;
}

beforeEach(() => {
  state.crafted = { ok: true, ideaId: IDEA_ID, matched: null };
  state.shaped = [];
  state.shapeResult = { message: 'Sent.' };
});

describe('Craft into a plan', () => {
  it('sends the idea the takeaway became to be shaped', async () => {
    const result = await craftTakeaway({}, form(TAKEAWAY_ID));

    expect(state.shaped).toEqual([IDEA_ID]);
    expect(result.error).toBeUndefined();
    expect(result.message).toMatch(/^Filed as an idea\. Sent to Dash to shape/);
  });

  it('names the idea it used when the takeaway repeated one already filed', async () => {
    state.crafted = { ok: true, ideaId: IDEA_ID, matched: { id: IDEA_ID, body: 'Show the diff first\n\nmore' } };
    const result = await craftTakeaway({}, form(TAKEAWAY_ID));

    expect(state.shaped).toEqual([IDEA_ID]);
    expect(result.message).toContain('This was already an idea ("Show the diff first")');
  });

  it('fires nothing when the takeaway cannot be crafted', async () => {
    state.crafted = { ok: false, error: 'This takeaway has already been crafted.' };
    const result = await craftTakeaway({}, form(TAKEAWAY_ID));

    expect(state.shaped).toEqual([]);
    expect(result).toEqual({ error: 'This takeaway has already been crafted.' });
  });

  it('says the idea was filed when the routine would not start', async () => {
    state.shapeResult = { error: 'The routine is not set up.' };
    const result = await craftTakeaway({}, form(TAKEAWAY_ID));

    expect(result.error).toBe(
      'Filed as an idea. It was not sent to be shaped: The routine is not set up. Shape it from the Ideas page.',
    );
  });

  it('refuses a missing id without reaching the database', async () => {
    expect(await craftTakeaway({}, form('nope'))).toEqual({ error: 'Missing takeaway.' });
    expect(state.shaped).toEqual([]);
  });
});
