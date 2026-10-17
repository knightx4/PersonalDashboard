import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';

vi.mock('@/lib/learn/areas/place-track', () => ({ placeTrackAfterResponse: vi.fn() }));
vi.mock('./load', () => ({ loadGoals: vi.fn(), loadSubject: vi.fn() }));
vi.mock('./save', () => ({ findOrCreateSubject: vi.fn() }));
vi.mock('./curriculum-store', () => ({
  ensureCurriculum: vi.fn(),
  fileGoalUnder: vi.fn(),
}));

import { placeTrackAfterResponse } from '@/lib/learn/areas/place-track';
import { makeCustomSubject } from './curriculum-run';
import { ensureCurriculum } from './curriculum-store';
import { findOrCreateSubject } from './save';

const supabase = { from: () => ({ update: () => ({ eq: async () => ({}) }) }) } as unknown as LearnSupabaseClient;
const ensured = { ok: true as const, units: [], goalUnitId: null, written: true };

describe('makeCustomSubject', () => {
  beforeEach(() => {
    vi.mocked(ensureCurriculum).mockReset().mockResolvedValue(ensured);
    vi.mocked(findOrCreateSubject).mockReset();
  });

  it('writes no curriculum for a new subject with no units of its own, leaving it to the preparation', async () => {
    vi.mocked(findOrCreateSubject).mockResolvedValue({ id: 's1', created: true, placed: false });
    const made = await makeCustomSubject(supabase, 'u', { name: 'SaaS metrics', want: null, units: '' });
    expect(made).toMatchObject({ ok: true, created: true, curriculum: { ok: true, units: [], written: false } });
    expect(ensureCurriculum).not.toHaveBeenCalled();
  });

  it('still saves the units the person typed for a new subject', async () => {
    vi.mocked(findOrCreateSubject).mockResolvedValue({ id: 's1', created: true, placed: false });
    await makeCustomSubject(supabase, 'u', { name: 'SaaS metrics', want: null, units: 'Churn\nCAC' });
    expect(ensureCurriculum).toHaveBeenCalledWith(supabase, 'u', { id: 's1', name: 'SaaS metrics' }, null, ['Churn', 'CAC']);
  });

  it('does not place a new subject itself, since its preparation places it when it finishes', async () => {
    vi.mocked(placeTrackAfterResponse).mockReset();
    vi.mocked(findOrCreateSubject).mockResolvedValue({ id: 's1', created: true, placed: false });
    await makeCustomSubject(supabase, 'u', { name: 'SaaS metrics', want: 'to price a plan', units: 'Churn' });
    expect(placeTrackAfterResponse).not.toHaveBeenCalled();
  });

  it('leaves a subject the person already had to the old path', async () => {
    vi.mocked(findOrCreateSubject).mockResolvedValue({ id: 's1', created: false, placed: true });
    await makeCustomSubject(supabase, 'u', { name: 'SaaS metrics', want: null, units: '' });
    expect(ensureCurriculum).toHaveBeenCalledTimes(1);
  });
});
