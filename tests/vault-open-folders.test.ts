/**
 * What the vault column remembers, and where.
 *
 * #567 settled it: the browser you are reading in, and nowhere else. So the
 * things worth pinning are that it round-trips, that it forgets a folder you
 * fold shut, and -- the half that actually breaks in the wild -- that a
 * browser with storage blocked throws on the way in and gets the default view
 * rather than an error halfway down a note.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  openFoldersServerSnapshot,
  openFoldersSnapshot,
  readOpenFolders,
  rememberOpenFolder,
} from '@/lib/vault/open-folders';

const KEY = 'pt_vault_open_folders';

/** Enough of `window.localStorage` for these two functions, and no more. */
function fakeStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    read: () => store.get(KEY) ?? null,
  };
}

function withStorage(storage: unknown) {
  (globalThis as { window?: unknown }).window = { localStorage: storage };
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe('the folders the vault column remembers', () => {
  it('comes back with what was left open', () => {
    withStorage(fakeStorage({ [KEY]: JSON.stringify(['Money', 'Recipes']) }));
    expect(readOpenFolders()).toEqual(['Money', 'Recipes']);
  });

  it('records a folder that was opened, keeping the ones already open', () => {
    const storage = fakeStorage({ [KEY]: JSON.stringify(['Money']) });
    withStorage(storage);
    rememberOpenFolder('Recipes', true);
    expect(readOpenFolders()).toEqual(['Money', 'Recipes']);
  });

  it('forgets a folder that was folded shut, and leaves the rest', () => {
    const storage = fakeStorage({ [KEY]: JSON.stringify(['Money', 'Recipes']) });
    withStorage(storage);
    rememberOpenFolder('Money', false);
    expect(readOpenFolders()).toEqual(['Recipes']);
  });

  it('records the vault root, which is a folder whose name is empty', () => {
    withStorage(fakeStorage());
    rememberOpenFolder('', true);
    expect(readOpenFolders()).toEqual(['']);
  });

  it('writes a folder once however often it is opened', () => {
    withStorage(fakeStorage());
    rememberOpenFolder('Money', true);
    rememberOpenFolder('Money', true);
    expect(readOpenFolders()).toEqual(['Money']);
  });

  it('keeps nothing anywhere but the one key', () => {
    const storage = fakeStorage();
    withStorage(storage);
    rememberOpenFolder('Money', true);
    expect(JSON.parse(storage.read() ?? 'null')).toEqual(['Money']);
  });

  it('starts from nothing when the stored value is not a list of folders', () => {
    withStorage(fakeStorage({ [KEY]: '{"Money":true}' }));
    expect(readOpenFolders()).toEqual([]);

    withStorage(fakeStorage({ [KEY]: 'not json at all' }));
    expect(readOpenFolders()).toEqual([]);

    withStorage(fakeStorage({ [KEY]: JSON.stringify(['Money', 7, null]) }));
    expect(readOpenFolders()).toEqual(['Money']);
  });

  it('does not throw where storage is blocked outright', () => {
    withStorage({
      getItem: () => {
        throw new Error('The operation is insecure.');
      },
      setItem: () => {
        throw new Error('The operation is insecure.');
      },
    });
    expect(readOpenFolders()).toEqual([]);
    expect(() => rememberOpenFolder('Money', true)).not.toThrow();
  });

  it('does not throw where there is no browser at all', () => {
    // Server rendering, and the reason nothing reads this during render.
    expect(readOpenFolders()).toEqual([]);
    expect(() => rememberOpenFolder('Money', true)).not.toThrow();
  });
});

/**
 * What the column actually renders from. It is read through
 * `useSyncExternalStore`, which compares snapshots by identity, so one value
 * has to come back however often it is read -- and it has to stop being that
 * value the moment a fold changes it, or moving to the next note would draw
 * the folds from before the last one.
 */
describe('the snapshot the column renders from', () => {
  it('is one value however often it is read', () => {
    withStorage(fakeStorage({ [KEY]: JSON.stringify(['Money']) }));
    const first = openFoldersSnapshot();
    expect(first).toEqual(['Money']);
    expect(openFoldersSnapshot()).toBe(first);
  });

  it('follows a fold, so the next note opens the way this one was left', () => {
    withStorage(fakeStorage({ [KEY]: JSON.stringify(['Money']) }));
    expect(openFoldersSnapshot()).toEqual(['Money']);
    rememberOpenFolder('Recipes', true);
    expect(openFoldersSnapshot()).toEqual(['Money', 'Recipes']);
  });

  it('is nothing on the server, which cannot know what this browser kept', () => {
    withStorage(fakeStorage({ [KEY]: JSON.stringify(['Money']) }));
    expect(openFoldersServerSnapshot()).toEqual([]);
  });
});
