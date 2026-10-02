/**
 * How a titled box is kept folded between visits (plan #1432).
 *
 * The things worth pinning: a fold round-trips, leaving a box its usual way
 * stores nothing, the key the jobs page already wrote still reads, and a
 * browser that blocks storage gets the box's default rather than an error.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { openFor, readFold, rememberFold } from '@/lib/fold-memory';

function fakeStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    has: (key: string) => store.has(key),
  };
}

function withStorage(storage: unknown) {
  (globalThis as { window?: unknown }).window = { localStorage: storage };
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe('fold memory', () => {
  it('keeps a box folded that opens by default', () => {
    const storage = fakeStorage();
    withStorage(storage);
    rememberFold('jobs.fold.Closed', false, true);
    expect(readFold('jobs.fold.Closed')).toBe(true);
    expect(openFor(true, readFold('jobs.fold.Closed'))).toBe(false);
  });

  it('keeps a box open that starts folded', () => {
    withStorage(fakeStorage());
    rememberFold('timeline.fold.2026-08', true, false);
    expect(openFor(false, readFold('timeline.fold.2026-08'))).toBe(true);
  });

  it('stores nothing for a box left the way it opens', () => {
    const storage = fakeStorage({ 'dev.fold.digest': '1' });
    withStorage(storage);
    rememberFold('dev.fold.digest', true, true);
    expect(storage.has('dev.fold.digest')).toBe(false);
    expect(openFor(true, readFold('dev.fold.digest'))).toBe(true);
  });

  it('reads the fold the recommendations kept before CardSection could fold', () => {
    withStorage(fakeStorage({ 'jobs.fold.Recommended roles': '1' }));
    expect(openFor(true, readFold('jobs.fold.Recommended roles'))).toBe(false);
  });

  it('falls back to the default when storage throws', () => {
    withStorage({
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    });
    expect(readFold('any')).toBeNull();
    expect(() => rememberFold('any', false, true)).not.toThrow();
    expect(openFor(true, readFold('any'))).toBe(true);
  });
});
