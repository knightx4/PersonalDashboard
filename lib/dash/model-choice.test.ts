import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { HAIKU, OPUS, SONNET } from '@/lib/core/models';
import { dashModelFor } from './model-choice';

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

describe('the model Dash answers an account with', () => {
  it('is the one the account chose', async () => {
    for (const id of [HAIKU, SONNET, OPUS]) {
      const c = coreReturning({ data: { dash_model: id }, error: null });
      expect(await dashModelFor(c.client, 'user-1')).toBe(id);
      expect(c.from).toHaveBeenCalledWith('account_settings');
      expect(c.select).toHaveBeenCalledWith('dash_model');
      expect(c.eq).toHaveBeenCalledWith('user_id', 'user-1');
    }
  });

  it('is Sonnet when nothing is saved or the read fails', async () => {
    expect(await dashModelFor(coreReturning({ data: { dash_model: null }, error: null }).client, 'u')).toBe(SONNET);
    expect(await dashModelFor(coreReturning({ data: null, error: null }).client, 'u')).toBe(SONNET);
    expect(
      await dashModelFor(coreReturning({ data: null, error: { code: '42703', message: 'no column' } }).client, 'u'),
    ).toBe(SONNET);
    expect(await dashModelFor(coreReturning(new Error('network')).client, 'u')).toBe(SONNET);
  });

  it('is Sonnet for a value outside the three models', async () => {
    expect(await dashModelFor(coreReturning({ data: { dash_model: 'gpt-4' }, error: null }).client, 'u')).toBe(SONNET);
  });
});
