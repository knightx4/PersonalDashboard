import { describe, expect, it, vi } from 'vitest';
import { jevEnabledFor } from './enabled';

/** A stand-in for the core client's one query: from().select().eq().maybeSingle(). */
function coreReturning(result: { data: unknown; error: unknown } | Error) {
  const maybeSingle = vi.fn(async () => {
    if (result instanceof Error) throw result;
    return result;
  });
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return { client: { from } as never, from, select, eq };
}

describe('whether an account may send text to Jev', () => {
  it('is true only when the account opted in', async () => {
    const yes = coreReturning({ data: { jev_enabled: true }, error: null });
    expect(await jevEnabledFor(yes.client, 'user-1')).toBe(true);
    expect(yes.from).toHaveBeenCalledWith('account_settings');
    expect(yes.eq).toHaveBeenCalledWith('user_id', 'user-1');

    expect(await jevEnabledFor(coreReturning({ data: { jev_enabled: false }, error: null }).client, 'u')).toBe(false);
  });

  it('reads anything it cannot be sure of as no', async () => {
    expect(await jevEnabledFor(coreReturning({ data: null, error: null }).client, 'u')).toBe(false);
    expect(
      await jevEnabledFor(coreReturning({ data: null, error: { code: '42703', message: 'no column' } }).client, 'u'),
    ).toBe(false);
    expect(await jevEnabledFor(coreReturning(new Error('network')).client, 'u')).toBe(false);
  });
});
