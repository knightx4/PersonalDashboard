import { describe, expect, it } from 'vitest';
import { companyCatchUpKey } from '@/lib/jobs/inbox/linker';

describe('companyCatchUpKey', () => {
  it('fits the catch-up table check', () => {
    const key = companyCatchUpKey('329ED3D0-C36A-42DB-8D4F-12BD9B2768BB');
    // core.inbox_catch_ups_linker_ck
    expect(key).toMatch(/^[a-z][a-z0-9_-]{0,40}$/);
    expect(key).toBe('jobs-co-329ed3d0c36a42db8d4f12bd9b2768bb');
  });
});
