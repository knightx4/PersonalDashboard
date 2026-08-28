/**
 * The environment must not be validated at module scope.
 *
 * It was, and it broke the first Vercel deploy: `next build` collects page data
 * by importing every route, so a module-scope `.parse()` made the build itself
 * require production secrets. It failed inside a compiled chunk with a Zod dump
 * and a stack trace naming no route and no variable — the local build had
 * passed only because the values happened to be on the command line.
 *
 * So: importing the module must be free, and the error when a value really is
 * missing must say which one and where to put it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const PUBLIC_KEYS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_APP_URL',
] as const;

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of PUBLIC_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  vi.resetModules();
});

afterEach(() => {
  for (const key of PUBLIC_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  vi.resetModules();
});

describe('importing lib/env', () => {
  it('does not throw when nothing is configured', async () => {
    // This is the assertion that protects the build.
    await expect(import('@/lib/env')).resolves.toBeDefined();
  });
});

describe('publicEnv()', () => {
  it('names the missing variables rather than dumping a schema error', async () => {
    const { publicEnv } = await import('@/lib/env');
    try {
      publicEnv();
      throw new Error('publicEnv() should have thrown');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('NEXT_PUBLIC_SUPABASE_URL');
      expect(message).toContain('NEXT_PUBLIC_SUPABASE_ANON_KEY');
      // And says where to put them, which is the part that saves the hour.
      expect(message).toMatch(/Vercel/);
      expect(message).toMatch(/\.env\.local/);
    }
  });

  it('does not complain about the app URL, which has a default', async () => {
    const { publicEnv } = await import('@/lib/env');
    expect(() => publicEnv()).toThrowError(
      expect.objectContaining({
        message: expect.not.stringContaining('NEXT_PUBLIC_APP_URL'),
      }),
    );
  });

  it('returns the values once they are set', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
    const { publicEnv } = await import('@/lib/env');
    expect(publicEnv()).toEqual({
      NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
      NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
    });
  });

  it('rejects a URL that is not one, rather than passing it to the client', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'your-project-ref';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
    const { publicEnv } = await import('@/lib/env');
    expect(() => publicEnv()).toThrowError(/NEXT_PUBLIC_SUPABASE_URL/);
  });
});
