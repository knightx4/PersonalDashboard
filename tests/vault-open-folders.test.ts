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
  columnFoldedServerSnapshot,
  columnFoldedSnapshot,
  foldedForView,
  openFoldersServerSnapshot,
  readColumnFolded,
  rememberColumnFolded,
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

/**
 * Whether the note list is folded away (#1381), kept beside the folders under
 * its own key and by the same rule: this browser, read through a snapshot,
 * and nothing worse than the list shown where storage will not cooperate.
 */
describe('whether the note list is folded', () => {
  const FOLDED_KEY = 'pt_vault_column_folded';

  function storageWith(initial: Record<string, string> = {}) {
    const store = new Map(Object.entries(initial));
    return {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      store,
    };
  }

  it('reads a stored fold', () => {
    withStorage(storageWith({ [FOLDED_KEY]: 'true' }));
    expect(readColumnFolded()).toBe(true);
  });

  it('reads the list as shown when nothing is stored', () => {
    withStorage(storageWith());
    expect(readColumnFolded()).toBe(false);
  });

  it('remembers a fold and an unfold, under its own key and nothing else', () => {
    const storage = storageWith({ [KEY]: JSON.stringify(['Money']) });
    withStorage(storage);
    rememberColumnFolded(true);
    expect(readColumnFolded()).toBe(true);
    rememberColumnFolded(false);
    expect(readColumnFolded()).toBe(false);
    expect([...storage.store.keys()].sort()).toEqual([KEY, FOLDED_KEY].sort());
    expect(readOpenFolders()).toEqual(['Money']);
  });

  it('reads anything unreadable as shown', () => {
    withStorage(storageWith({ [FOLDED_KEY]: '{"folded":true}' }));
    expect(readColumnFolded()).toBe(false);
    withStorage(storageWith({ [FOLDED_KEY]: 'yes' }));
    expect(readColumnFolded()).toBe(false);
  });

  it('shows the list and does not throw where storage throws', () => {
    withStorage({
      getItem: () => {
        throw new Error('The operation is insecure.');
      },
      setItem: () => {
        throw new Error('The operation is insecure.');
      },
    });
    expect(() => rememberColumnFolded(true)).not.toThrow();
    expect(readColumnFolded()).toBe(false);
    expect(columnFoldedSnapshot()).toBe(false);
  });

  it('shows the list where there is no browser at all', () => {
    expect(readColumnFolded()).toBe(false);
    expect(() => rememberColumnFolded(true)).not.toThrow();
  });

  it('gives one snapshot until a press changes it, and the server always shown', () => {
    withStorage(storageWith({ [FOLDED_KEY]: 'false' }));
    rememberColumnFolded(false);
    expect(columnFoldedSnapshot()).toBe(false);
    rememberColumnFolded(true);
    expect(columnFoldedSnapshot()).toBe(true);
    expect(columnFoldedServerSnapshot()).toBe(false);
  });
});

/** Which way the list is drawn on the note in front of you. */
describe('the fold on the note in front of you', () => {
  const RENT = 'Money/Rent.md';
  const BILLS = 'Money/Bills.md';

  it('follows what is stored when nothing has been pressed', () => {
    expect(
      foldedForView({ notePath: RENT, arrivedWithSearch: false, stored: true, pressed: null }),
    ).toBe(true);
    expect(
      foldedForView({ notePath: RENT, arrivedWithSearch: false, stored: false, pressed: null }),
    ).toBe(false);
  });

  it('shows the list on a note arrived at with a search, whatever is stored', () => {
    expect(
      foldedForView({ notePath: RENT, arrivedWithSearch: true, stored: true, pressed: null }),
    ).toBe(false);
  });

  it('folds that note once the list is folded there', () => {
    const pressed = { notePath: RENT, folded: true };
    expect(foldedForView({ notePath: RENT, arrivedWithSearch: true, stored: true, pressed })).toBe(
      true,
    );
  });

  it('keeps a press on the note it was made on where storage kept nothing', () => {
    const pressed = { notePath: RENT, folded: true };
    expect(
      foldedForView({ notePath: RENT, arrivedWithSearch: false, stored: false, pressed }),
    ).toBe(true);
    // The next note reads storage, which a blocked browser says is shown.
    expect(
      foldedForView({ notePath: BILLS, arrivedWithSearch: false, stored: false, pressed }),
    ).toBe(false);
  });

  it('carries a stored fold to the next note', () => {
    const pressed = { notePath: RENT, folded: true };
    expect(
      foldedForView({ notePath: BILLS, arrivedWithSearch: false, stored: true, pressed }),
    ).toBe(true);
  });
});
