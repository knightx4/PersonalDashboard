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
   * The mark's gradient, as two fixed hexes.
   *
   * Deliberately not theme-aware. A workspace mark is an object -- the same
   * idea as an app icon -- and an app icon does not invert when the OS goes
   * dark. Fixing it also means the white glyph on it is legible once rather
   * than in five places, and the gradient can run rich-to-deep within one hue
   * instead of being the flat tint that made these read as dead.
   */
  mark: readonly [string, string];
  /** Lucide icon name, resolved by components/ui/module-icon.tsx. */
  icon: ModuleIconName;
};

/**
 * One glyph per module, everywhere it appears -- the switcher, the home
 * tiles, the Account toggles. Named here rather than imported here so this
 * file stays free of client-only code and can be read on the server.
 */
export type ModuleIconName = 'shopping' | 'jobs' | 'todo' | 'vault' | 'home';

export const MODULES: readonly AppModule[] = [
  {
    id: 'shopping',
    prefix: '/shopping',
    home: '/shopping/dashboard',
    label: 'Shopping',
    description: 'Orders, inventory, returns and resale',
    accent: '--color-w-shopping',
    mark: ['#be123c', '#8a0c2b'],
    icon: 'shopping',
  },
  {
    id: 'jobs',
    prefix: '/jobs',
    home: '/jobs/today',
    label: 'Job search',
    description: 'Pipeline, roles, companies and interviews',
    accent: '--color-w-jobs',
    mark: ['#6d28d9', '#4f1ba0'],
    icon: 'jobs',
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
    mark: ['#0369a1', '#024a73'],
    icon: 'todo',
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
    mark: ['#9d1bab', '#6f1279'],
    icon: 'vault',
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
  mark: ['#4338ca', '#312a94'],
  icon: 'home',
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
