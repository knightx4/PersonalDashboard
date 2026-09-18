/**
 * Which folders of the vault column you left open, per browser.
 *
 * #567 settled where this lives: in the browser you are reading in, and
 * nowhere else. So no column on the account and nothing in the address bar --
 * a note keeps one link, and a laptop and a phone each remember their own.
 *
 * Every access is guarded, because `localStorage` does not merely come back
 * empty where site data is blocked, it throws on the way in. Losing the memory
 * is the smallest possible failure here: #557 already settled that the column
 * opens with the folder you are reading in open, so a browser that cannot
 * store anything gets exactly that view and nothing breaks.
 *
 * Pure and separate from the component so both halves can be tested without a
 * DOM, and named for what it stores rather than for who reads it -- #577 puts
 * the same tree in a phone sheet and will want the same list.
 */

/** One key for the whole vault, alongside `pt_last_path` and `pt_nav_collapsed`. */
const OPEN_FOLDERS_KEY = 'pt_vault_open_folders';

/** Nothing remembered: what the server renders, and every first paint. */
const NOTHING: readonly string[] = [];

/**
 * The folders left open, as folder paths -- `''` for the vault root, the same
 * key `groupByFolder` groups by.
 *
 * Anything that is not a list of strings is treated as nothing remembered
 * rather than repaired: the value is disposable, and a viewer whose storage
 * holds something older than this code should get today's default view, not a
 * crash halfway down a note.
 */
export function readOpenFolders(): string[] {
  try {
    const raw = window.localStorage.getItem(OPEN_FOLDERS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((folder): folder is string => typeof folder === 'string');
  } catch {
    /* No storage, or something unreadable in it: nothing is remembered. */
    return [];
  }
}

/**
 * The three pieces `useSyncExternalStore` wants, because that is how a value
 * the server cannot know is read without setting state from an effect -- the
 * same call `components/ui/timezone-field.tsx` makes for the detected zone.
 *
 * The snapshot has to be one value rather than a fresh array each time, or
 * React reads a change on every render and never settles; it is thrown away on
 * every write instead, so the next read comes back off storage.
 */
let cached: readonly string[] | null = null;

/** Record one folder as left open, or drop it once it is folded shut. */
export function rememberOpenFolder(folder: string, open: boolean): void {
  cached = null;
  try {
    const next = readOpenFolders().filter((remembered) => remembered !== folder);
    if (open) next.push(folder);
    window.localStorage.setItem(OPEN_FOLDERS_KEY, JSON.stringify(next));
  } catch {
    /* A viewer who blocks storage simply starts from the default view again. */
  }
}

/** Nothing here changes under the page; a fold is the only writer. */
export function subscribeToOpenFolders(): () => void {
  return () => {};
}

export function openFoldersSnapshot(): readonly string[] {
  cached ??= readOpenFolders();
  return cached;
}

export function openFoldersServerSnapshot(): readonly string[] {
  return NOTHING;
}
