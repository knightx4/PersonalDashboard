/**
 * The modules this account holds, in one list.
 *
 * There were two of these lists — the workspace switcher's and the home page's
 * tiles — and the second one was written when there were two modules. The
 * vault arrived, was added to the switcher, and never showed up on the home
 * page, which is exactly the failure a second list guarantees eventually.
 *
 * So: one list. Add a module here and it appears in the switcher, in the
 * switcher menu, and as a tile on the home page. Its tile shows a count when
 * the home page knows how to count it, and its description otherwise — a new
 * module is never invisible while waiting for someone to write the query.
 */

export type ModuleId = 'shopping' | 'jobs' | 'vault' | 'todo';

export type AppModule = {
  id: ModuleId;
  /** Path prefix that means "you are in this module". */
  prefix: string;
  /** Where switching to it lands: the page answering "what is going on". */
  home: string;
  label: string;
  description: string;
  /**
   * The workspace's own hue, as a CSS variable name. The shell sets
   * data-workspace and globals.css resolves it to --color-accent, so no
   * component ever names a workspace colour directly.
   *
   * The four are stops on one arc -- sky, violet, fuchsia, rose -- with the
   * app's indigo at the blue end. Drawn from a single sweep rather than from
   * around the wheel, which is what keeps four differently-coloured
   * workspaces reading as one product rather than four sharing a login.
   */
  accent: `--color-w-${ModuleId}`;
  /**
   * The one square in the mark that changes.
   *
   * Every mark is the same four-node square: three constant nodes in
   * monochrome, and this in the top-right corner. It is the only colour in the
   * mark and the only shape that is not a square, which is what makes it read
   * as a key rather than as a fourth node.
   *
   * A shape *and* a hue, deliberately -- either alone would run out. Position
   * ran out at four modules, which is what this replaces; hue alone stops
   * being distinguishable somewhere around six. Together they will go as far
   * as anyone sensibly takes this.
   *
   * The hexes are fixed rather than themed. A mark is an object, and an app
   * icon does not invert when the OS goes dark.
   */
  key: MarkKey;
};

/**
 * The shapes the changing square can take, in the order they were assigned.
 *
 * Each has to survive about twelve pixels, which rules out anything with an
 * interior detail -- no glyphs, no letters, nothing hollow with a thin wall.
 * These five are told apart by silhouette alone at that size; the next module
 * takes the next unused one.
 */
export type MarkShape = 'circle' | 'diamond' | 'triangle' | 'quarter' | 'pill';

export interface MarkKey {
  shape: MarkShape;
  /** Rich to deep within one hue. See HOME_MARK for the one exception. */
  from: string;
  to: string;
}

export const MODULES: readonly AppModule[] = [
  {
    id: 'shopping',
    prefix: '/shopping',
    home: '/shopping/dashboard',
    label: 'Shopping',
    description: 'Orders, inventory, returns and resale',
    accent: '--color-w-shopping',
    key: { shape: 'diamond', from: '#fb7185', to: '#be123c' },
  },
  {
    id: 'jobs',
    prefix: '/jobs',
    home: '/jobs/today',
    label: 'Job search',
    description: 'Pipeline, roles, companies and interviews',
    accent: '--color-w-jobs',
    key: { shape: 'triangle', from: '#c4b5fd', to: '#7c3aed' },
  },
  {
    id: 'todo',
    prefix: '/todo',
    // The agenda, not the archive: "what has to happen" is the question this
    // module answers, and /todo/all is the pile you consult afterwards.
    home: '/todo',
    label: 'Todo',
    description: 'What has to happen, across everything',
    accent: '--color-w-todo',
    key: { shape: 'quarter', from: '#7dd3fc', to: '#0369a1' },
  },
  {
    id: 'vault',
    prefix: '/vault',
    // The note list, not settings: "what is in here" is the question this
    // workspace answers, and it is the only page it has that answers one.
    home: '/vault',
    label: 'Vault',
    description: 'Your Obsidian notes, mirrored and searchable',
    accent: '--color-w-vault',
    key: { shape: 'pill', from: '#f0abfc', to: '#a21caf' },
  },
] as const;

/**
 * The mark for the whole app: the topbar when no module is active, and every
 * signed-out page.
 *
 * The app's own accent rather than a module's, and flat rather than a
 * gradient. A two-hue ramp was decoration pretending to be identity -- three
 * of the four module marks started on the same blue, so the hue was not
 * something a person could identify a workspace by. The glyph is the
 * mnemonic; the hue confirms it.
 */
export const HOME_MARK = {
  label: 'Home',
  accent: '--color-accent',
  /**
   * The app's own key, and the one place two hues are allowed to meet.
   *
   * Everywhere else a gradient stays inside a single hue, because a two-hue
   * ramp is decoration pretending to be identity. Here it *is* the identity:
   * blue into pink is what this product has used for itself since before it
   * had modules, and the home mark is the only thing entitled to wear it.
   */
  key: { shape: 'circle', from: '#6a82fb', to: '#ff6b9d' },
} as const;

export function moduleById(id: ModuleId | null): AppModule | null {
  if (id === null) return null;
  return MODULES.find((module) => module.id === id) ?? null;
}

/**
 * Whether a string is one of these.
 *
 * Needed because `core.account_settings.enabled_modules` is a text[] and a
 * module removed from this list should leave a harmless string in the column
 * rather than an id nothing can look up.
 */
export function isModuleId(value: string): value is ModuleId {
  return MODULES.some((module) => module.id === value);
}

/**
 * Just the ids, for the places that store or compare them rather than render
 * them -- `core.account_settings.enabled_modules` above all.
 */
export const MODULE_IDS: readonly ModuleId[] = MODULES.map((module) => module.id);
