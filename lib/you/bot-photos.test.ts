import { describe, expect, it, vi } from 'vitest';
import type { YouSupabaseClient } from '@/lib/you/db/schema-name';
import { setBotPhoto, signBotPhotos } from '@/lib/you/bot-photos';

const USER = '11111111-1111-4111-8111-111111111111';
const BOT = '22222222-2222-4222-8222-222222222222';
const NEW = `${USER}/${BOT}/33333333-3333-4333-8333-333333333333.png`;
const OLD = `${USER}/${BOT}/44444444-4444-4444-8444-444444444444.jpg`;

/** A client whose bot row holds `stored`, recording the update and what storage removes. */
function fakeClient(stored: string | null | undefined) {
  const updates: unknown[] = [];
  const removed: string[][] = [];
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: async () => ({ data: stored === undefined ? null : { photo_path: stored }, error: null }),
    update: (values: unknown) => {
      updates.push(values);
      return { eq: () => ({ eq: async () => ({ error: null }) }) };
    },
  };
  const client = {
    from: () => query,
    storage: {
      from: () => ({
        remove: async (paths: string[]) => {
          removed.push(paths);
          return { error: null };
        },
        createSignedUrls: vi.fn(async (paths: string[]) => ({
          data: paths.map((path) => ({ path, signedUrl: `https://signed/${path}`, error: null })),
          error: null,
        })),
      }),
    },
  } as unknown as YouSupabaseClient;
  return { client, updates, removed };
}

describe("setting a bot's picture (plan #2955)", () => {
  it('points the bot at the new picture and removes the one it replaces', async () => {
    const { client, updates, removed } = fakeClient(OLD);
    expect(await setBotPhoto(client, USER, BOT, NEW)).toBe(true);
    expect(updates).toEqual([{ photo_path: NEW }]);
    expect(removed).toEqual([[OLD]]);
  });

  it('takes the picture off, removing it', async () => {
    const { client, updates, removed } = fakeClient(OLD);
    expect(await setBotPhoto(client, USER, BOT, null)).toBe(true);
    expect(updates).toEqual([{ photo_path: null }]);
    expect(removed).toEqual([[OLD]]);
  });

  it('removes nothing when there was no picture', async () => {
    const { client, removed } = fakeClient(null);
    expect(await setBotPhoto(client, USER, BOT, NEW)).toBe(true);
    expect(removed).toEqual([]);
  });

  it('refuses a path filed under another bot, and says when the bot is not theirs', async () => {
    const { client, updates } = fakeClient(OLD);
    await expect(setBotPhoto(client, USER, BOT, `${USER}/${USER}/33333333-3333-4333-8333-333333333333.png`)).rejects.toThrow();
    expect(updates).toEqual([]);
    expect(await setBotPhoto(fakeClient(undefined).client, USER, BOT, NEW)).toBe(false);
  });

  it('signs each stored path once and skips empty ones', async () => {
    const { client } = fakeClient(null);
    const signed = await signBotPhotos(client, [NEW, NEW, null, '']);
    expect([...signed.entries()]).toEqual([[NEW, `https://signed/${NEW}`]]);
  });
});
