import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { sourceClient } = await import('./client');

describe('the client a search source reads through', () => {
  it('is the caller’s when it passes its own, so search works with no cookie (the connector, a scheduled run)', async () => {
    const own = vi.fn(async () => 'cookie client');
    const db = vi.fn(async (schema: string) => `token client for ${schema}`);
    expect(await sourceClient({ userId: 'u', limit: 5, db }, 'todo', own)).toBe('token client for todo');
    expect(own).not.toHaveBeenCalled();
  });

  it('is the source’s own cookie client in the command box', async () => {
    expect(await sourceClient({ userId: 'u', limit: 5 }, 'todo', async () => 'cookie client')).toBe('cookie client');
  });
});
