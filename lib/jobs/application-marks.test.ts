import { beforeEach, describe, expect, it, vi } from 'vitest';
import { marksFromRow } from './application-marks';

const state = vi.hoisted(() => ({
  patch: null as unknown,
  filters: [] as Array<[string, unknown]>,
  error: null as null | { message: string },
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/jobs/auth/server', () => ({
  requireUser: async () => ({ id: 'user-1' }),
  createClient: async () => ({
    from: () => ({
      update: (patch: unknown) => {
        state.patch = patch;
        const chain = {
          eq: (col: string, val: unknown) => {
            state.filters.push([col, val]);
            return state.filters.length >= 2 ? Promise.resolve({ error: state.error }) : chain;
          },
        };
        return chain;
      },
    }),
  }),
}));
vi.mock('@/lib/jobs/companies/ensure', () => ({ ensureCompany: vi.fn() }));

const APP = '11111111-1111-4111-8111-111111111111';
const ROLE = '22222222-2222-4222-8222-222222222222';

describe('marksFromRow', () => {
  it('reads all three marks', () => {
    expect(
      marksFromRow({ ready_to_apply: true, all_questions_added: true, has_cover_letter: false }),
    ).toEqual({
      readyToApply: true,
      allQuestionsAdded: true,
      hasCoverLetter: false,
    });
  });

  it('defaults what the row lacks', () => {
    expect(marksFromRow({})).toEqual({
      readyToApply: false,
      allQuestionsAdded: false,
      hasCoverLetter: null,
    });
    expect(
      marksFromRow({ ready_to_apply: null, all_questions_added: null, has_cover_letter: null }),
    ).toEqual({
      readyToApply: false,
      allQuestionsAdded: false,
      hasCoverLetter: null,
    });
  });
});

describe('saveApplicationMarks', () => {
  beforeEach(() => {
    state.patch = null;
    state.filters = [];
    state.error = null;
  });

  it('saves ready alone, scoped to the owner', async () => {
    const { saveApplicationMarks } = await import('@/app/jobs/(app)/roles/[id]/actions');
    const r = await saveApplicationMarks({ applicationId: APP, roleId: ROLE, readyToApply: true });
    expect(r.error).toBeNull();
    expect(state.patch).toEqual({ ready_to_apply: true });
    expect(state.filters).toEqual([
      ['id', APP],
      ['user_id', 'user-1'],
    ]);
  });

  it('saves all questions added alone, and with another mark', async () => {
    const { saveApplicationMarks } = await import('@/app/jobs/(app)/roles/[id]/actions');
    await saveApplicationMarks({ applicationId: APP, roleId: ROLE, allQuestionsAdded: true });
    expect(state.patch).toEqual({ all_questions_added: true });
    state.filters = [];
    await saveApplicationMarks({
      applicationId: APP,
      roleId: ROLE,
      readyToApply: true,
      allQuestionsAdded: false,
    });
    expect(state.patch).toEqual({ ready_to_apply: true, all_questions_added: false });
  });

  it('saves yes, no and a cleared cover letter answer', async () => {
    const { saveApplicationMarks } = await import('@/app/jobs/(app)/roles/[id]/actions');
    await saveApplicationMarks({ applicationId: APP, roleId: ROLE, hasCoverLetter: false });
    expect(state.patch).toEqual({ has_cover_letter: false });
    state.filters = [];
    await saveApplicationMarks({ applicationId: APP, roleId: ROLE, hasCoverLetter: null });
    expect(state.patch).toEqual({ has_cover_letter: null });
  });

  it('refuses an empty save and a bad id without writing', async () => {
    const { saveApplicationMarks } = await import('@/app/jobs/(app)/roles/[id]/actions');
    const empty = await saveApplicationMarks({ applicationId: APP, roleId: ROLE });
    expect(empty.error).toBe('Nothing to save.');
    const bad = await saveApplicationMarks({
      applicationId: 'x',
      roleId: ROLE,
      readyToApply: true,
    });
    expect(bad.error).toBeTruthy();
    expect(state.patch).toBeNull();
  });

  it('returns the database error', async () => {
    state.error = { message: 'boom' };
    const { saveApplicationMarks } = await import('@/app/jobs/(app)/roles/[id]/actions');
    const r = await saveApplicationMarks({ applicationId: APP, roleId: ROLE, readyToApply: false });
    expect(r.error).toBe('boom');
  });
});
