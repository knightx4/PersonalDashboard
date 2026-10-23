import { beforeEach, describe, expect, it, vi } from 'vitest';

const updates: Record<string, unknown>[] = [];

vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('@/lib/jobs/auth/server', () => {
  const chain = {
    update: (values: Record<string, unknown>) => {
      updates.push(values);
      return chain;
    },
    eq: () => chain,
    then: (resolve: (value: { error: null }) => void) => resolve({ error: null }),
  };
  return {
    requireUser: async () => ({ id: 'u1' }),
    createClient: async () => ({ from: () => chain }),
  };
});
vi.mock('@/lib/jobs/companies/ensure', () => ({ ensureCompany: async () => ({}) }));
vi.mock('@/lib/jobs/contacts/edit', () => ({}));
vi.mock('@/lib/jobs/ats', () => ({ detectPosting: () => null }));
vi.mock('@/lib/jobs/suggest/press', () => ({}));

const ID = '5f4e3f0e-3b0b-4c45-9a39-2f1a1c1d9a11';

describe('dismissOpening', () => {
  beforeEach(() => {
    updates.length = 0;
  });

  it('keeps the company in later searches when the tick is off', async () => {
    const { dismissOpening } = await import('@/app/jobs/(app)/find/recommend-actions');
    await dismissOpening(ID, '  too senior ');
    expect(updates[0]).toMatchObject({ status: 'dismissed', dismiss_reason: null, dismiss_text: 'too senior' });
  });

  it('sets the company reason, with the text, when Never this company is ticked', async () => {
    const { dismissOpening } = await import('@/app/jobs/(app)/find/recommend-actions');
    await dismissOpening(ID, '', true);
    expect(updates[0]).toMatchObject({ status: 'dismissed', dismiss_reason: 'company', dismiss_text: null });
  });
});
