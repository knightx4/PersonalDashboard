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

export type ModuleId = 'shopping' | 'jobs' | 'vault' | 'todo' | 'learn' | 'dev';

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
   * A picture *and* a hue, deliberately -- either alone would run out. Position
   * ran out at four modules, which is what this replaces; hue alone stops
   * being distinguishable somewhere around six. Together they go as far as
   * anyone sensibly takes this, and the picture means a new module is
   * recognisable before anyone has learned its colour.
   *
   * The hexes are fixed rather than themed. A mark is an object, and an app
   * icon does not invert when the OS goes dark.
   */
  key: MarkKey;
};

/**
 * The shapes the changing square can take.
 *
 * Each is a picture of what the module is, and each is a *solid silhouette* --
 * no strokes, no counters, no interior gap narrower than about a sixth of the
 * shape. That constraint is the whole reason these read: a stroked glyph at
 * this size is a smudge, and an outline of a briefcase is indistinguishable
 * from an outline of a bag.
 *
 * They are also all drawn from one vocabulary -- flats, right angles and 45
 * degree cuts, radii around a sixth of the shape. There are no arcs and no
 * circles left in the set, which is what stops seven silhouettes chosen for
 * seven different reasons from looking like seven different people drew them.
 *
 * 'dash' is the app itself and is the only abstract one, which is the point --
 * it is the whole rather than one of the parts. It is also the only key that
 * is a single element, and deliberately the flattest and widest thing any mark
 * contains, because on the home page and in a browser tab it is the mark.
 */
export type MarkShape = 'dash' | 'bag' | 'briefcase' | 'check' | 'page' | 'stack' | 'bolt';

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
    key: { shape: 'bag', from: '#fb7185', to: '#be123c' },
  },
  {
    id: 'jobs',
    prefix: '/jobs',
    home: '/jobs/today',
    label: 'Job search',
    description: 'Pipeline, roles, companies and interviews',
    accent: '--color-w-jobs',
    key: { shape: 'briefcase', from: '#c4b5fd', to: '#7c3aed' },
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
    key: { shape: 'check', from: '#7dd3fc', to: '#0369a1' },
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
    key: { shape: 'page', from: '#f0abfc', to: '#a21caf' },
  },
  {
    id: 'learn',
    prefix: '/learn',
    // The tracks, not a reading. "What am I part way through" is the question
    // this module answers, and it is the only page that answers one.
    home: '/learn',
    label: 'Learn',
    description: 'Things worth reading, resolved and queued',
    accent: '--color-w-learn',
    // Teal, at the cold end of the sweep the other four sit on -- sky, violet,
    // fuchsia, rose -- rather than somewhere else on the wheel, which is what
    // keeps five differently-coloured workspaces reading as one product.
    key: { shape: 'stack', from: '#5eead4', to: '#0f766e' },
  },
  {
    id: 'dev',
    prefix: '/dev',
    // Bugs and requests, not the ideas list: the queue is the thing with work
    // in it, and the ideas are what you read when there is none.
    home: '/dev/bugs',
    label: 'Dev',
    description: 'Bugs, the build plan and long-term ideas for this app',
    accent: '--color-w-dev',
    // Steel, and the one workspace deliberately off the sweep the others sit
    // on. This is the app looking at itself rather than a place work lives,
    // and a sixth hue on the same arc would have been the first pair anyone
    // confused -- teal and green side by side in the same switcher.
    key: { shape: 'bolt', from: '#94a3b8', to: '#475569' },
  },
] as const;

/**
 * The mark for the whole app: the topbar when no module is active, every
 * signed-out page, and the favicon.
 *
 * The app's own accent rather than a module's, and flat rather than a
 * gradient. A two-hue ramp was decoration pretending to be identity -- three
 * of the four module marks started on the same blue, so the hue was not
 * something a person could identify a workspace by. The glyph is the
 * mnemonic; the hue confirms it.
 *
 * -- Why a dash --
 * The key was an orb: a filled circle, the largest coloured area in any mark
 * in the set, and the only shape in the whole system with no drawn corner. It
 * had two problems at once. It was where nearly all of the mark's colour went,
 * so the app read as a gradient blob rather than as a black-and-white
 * constellation with something bright in the corner; and being a circle among
 * six angular silhouettes, it looked like a logo that had wandered in from
 * another product rather than the head of this family.
 *
 * A dash fixes both. It is punctuation -- flat, horizontal, cut square at both
 * ends, drawn with exactly the same instrument as the stack's bars and the
 * page's fold. It carries under half the orb's ink, which is what turns the
 * gradient from the subject of the mark into a flare across it. And it is the
 * only element in any mark that is emphatically wider than it is tall, so it
 * is what the eye reaches first even at sixteen pixels, where every other
 * shape in the set has already given up its detail.
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
   *
   * Kept exactly as it was through the redraw, on purpose. The brief was to
   * spend less of the mark on it, not to change it -- these two hexes are the
   * one thing about this product's appearance that predates everything else in
   * this file.
   */
  key: { shape: 'dash', from: '#6a82fb', to: '#ff6b9d' },
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

/**
 * The workspace a path belongs to, or null when it belongs to none.
 *
 * Anything filed from the header carries the page it was filed from and not a
 * module, because the button that files it is in the header of every
 * workspace. The path is the only thing that says where the person was
 * standing, and `prefix` is what turns it back into a workspace.
 */
export function moduleForPath(path: string | null): ModuleId | null {
  if (!path) return null;
  const match = MODULES.find(
    (module) => path === module.prefix || path.startsWith(`${module.prefix}/`),
  );
  return match?.id ?? null;
}
