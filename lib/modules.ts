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

export type ModuleId =
  | 'shopping'
  | 'jobs'
  | 'vault'
  | 'todo'
  | 'learn'
  | 'news'
  | 'goals'
  | 'you'
  | 'dev';

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
   * What this module's mark draws, and in what hue.
   *
   * A picture *and* a hue, deliberately -- either alone would run out. Hue
   * alone stops being distinguishable somewhere around six; a picture alone
   * makes a new module recognisable before anyone has learned its colour.
   *
   * The hexes are fixed rather than themed. A mark is an object, and an app
   * icon does not invert when the OS goes dark -- the *ground* it sits on is
   * what follows the theme, and that happens in module-mark.tsx.
   */
  key: MarkKey;
  /**
   * Only the owner of the app sees this workspace.
   *
   * Dev is the app looking at itself -- the build plan, the bug queue, the
   * raises -- and three accounts sign in here. `modulesFor` below is what
   * every list of workspaces goes through, so a module marked this way is
   * absent from the switcher, from the home tiles and from the account page's
   * checkboxes for everybody else, rather than present and refused when
   * pressed.
   *
   * Absent means "everyone", which is the right default for a module: a new
   * workspace is owner-only only if somebody says so.
   */
  ownerOnly?: true;
  /**
   * Switching to it always lands on `home`, never on the page you were last
   * on inside it.
   *
   * Learn is the one: opening it is meant to put a question in front of you
   * (plan #773), and landing back on a reading list you left yesterday would
   * make that depend on where you happened to stop.
   */
  alwaysHome?: true;
  /**
   * The workspace's own settings page, and a line saying what is on it.
   * Account's Workspaces tab builds its list of settings links from these, so
   * a workspace that has a settings page is never left out of it (plan #1924).
   * Absent means the workspace has no settings page.
   */
  settings?: { href: string; hint: string };
};

/**
 * The objects a mark can draw.
 *
 * Each is drawn in two layers (components/ui/module-mark.tsx): a solid shape in
 * the module's hue at the back, and a pane of glass in front that blurs it,
 * with the detail that names the object drawn on the glass. The price tag is
 * there because Shopping covers resale; the safe because the vault is where
 * the notes are kept; the summit because a goal is somewhere you are climbing
 * to. Learn's own Goals tab draws a target, so Goals does not.
 *
 * 'dash' is the app itself: Dash's capsule visor on a dark plate, the same
 * drawing as the app icon.
 */
export type MarkShape =
  | 'dash'
  | 'tag'
  | 'briefcase'
  | 'check'
  | 'safe'
  | 'book'
  | 'envelope'
  | 'summit'
  | 'person'
  | 'terminal';

export interface MarkKey {
  shape: MarkShape;
  /**
   * Light to deep within one hue, and `to` is always the workspace's own
   * accent from globals.css. That is the invariant worth keeping: a mark whose
   * deep stop is some other rose than the rose the workspace paints its
   * buttons is two products in one sidebar. Change one, change both.
   *
   * See HOME_MARK for the one place two hues are allowed to meet.
   */
  from: string;
  to: string;
  /** A third stop, mid-ramp. Only the home mark has one. */
  mid?: string;
}

export const MODULES: readonly AppModule[] = [
  {
    id: 'shopping',
    prefix: '/shopping',
    home: '/shopping/dashboard',
    label: 'Shopping',
    description: 'Orders, inventory, returns and resale',
    accent: '--color-w-shopping',
    key: { shape: 'tag', from: '#fb7185', to: '#be123c' },
    settings: { href: '/shopping/settings', hint: 'Connected mailbox, merchants and return windows' },
  },
  {
    id: 'jobs',
    prefix: '/jobs',
    home: '/jobs',
    label: 'Job search',
    description: 'Pipeline, roles, companies and interviews',
    accent: '--color-w-jobs',
    key: { shape: 'briefcase', from: '#a78bfa', to: '#7c3aed' },
    settings: { href: '/jobs/settings', hint: 'Ghost threshold, résumés and evidence' },
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
    key: { shape: 'check', from: '#38bdf8', to: '#0369a1' },
    settings: { href: '/todo/settings', hint: 'How far ahead the agenda looks, and what feeds it' },
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
    key: { shape: 'safe', from: '#f0abfc', to: '#a21caf' },
    settings: { href: '/vault/settings', hint: 'The repository this mirrors, and its token' },
  },
  {
    id: 'learn',
    prefix: '/learn',
    // Now, the first tab (plan #1486). /learn redirects there too, but naming
    // it here saves the switcher a redirect.
    home: '/learn/now',
    alwaysHome: true,
    label: 'Learn',
    description: 'Questions until you stop, and what to read',
    accent: '--color-w-learn',
    // Teal leaning to cyan, halfway between Goals' emerald and Todo's sky, so
    // the three cool workspaces sit evenly apart. The deep end is the
    // workspace accent.
    key: { shape: 'book', from: '#5ad8dc', to: '#046a6b' },
  },
  {
    id: 'news',
    prefix: '/news',
    // Quick read, one story at a time (#848). The list of what has arrived is
    // /news/all, the second tab.
    home: '/news',
    label: 'News',
    description: 'Newsletters sent to an address of your own',
    accent: '--color-w-news',
    // Gold, and the only warm yellow in the app. It is off the sweep the other
    // four sit on for the same reason dev is: the arc ran out at rose, and the
    // next stop along it would have been the caution amber. Gold sits further
    // from the warning colour in all four themes than rose sits from the
    // delete red, which is the distance this set already accepts.
    key: { shape: 'envelope', from: '#e8c760', to: '#846905' },
    settings: { href: '/news/settings', hint: 'Your newsletter address, hidden topics and local area' },
  },
  {
    id: 'goals',
    prefix: '/goals',
    // The daily view: the next few things per goal (docs/GOALS-SPEC.md).
    home: '/goals',
    label: 'Goals',
    description: 'What you are working towards, and the next step on each',
    accent: '--color-w-goals',
    // Emerald, chosen over the lime it replaced. It sits near the positive
    // colour, which means money came back, so it is checked against it in
    // scripts/check-contrast.ts like every accent.
    key: { shape: 'summit', from: '#5eeab0', to: '#05734e' },
  },
  {
    id: 'you',
    prefix: '/you',
    // Personality, the first tab. /you redirects there too, but naming it
    // here saves the switcher a redirect (plan #1991.1).
    home: '/you/personality',
    label: 'You',
    description: 'Personality, places, work and school',
    accent: '--color-w-you',
    // Lime, in the widest gap left on the circle: OKLCH hue 128, midway
    // between News' gold at 92 and Goals' emerald at 162, and nearly eighty
    // degrees clear of the caution amber. Every cool hue from teal to violet
    // is already taken, and the warm side is rose, delete red and caution.
    key: { shape: 'person', from: '#b2e172', to: '#4d6f0b' },
  },
  {
    id: 'dev',
    prefix: '/dev',
    // Dash, not the bug list: every bug report is closed, and Dash is the one
    // page that carries what is still waiting -- the raises, the blocked steps
    // and the questions nobody has answered.
    home: '/dev/raised',
    label: 'Dev',
    description: 'Bugs, the build plan and long-term ideas for this app',
    accent: '--color-w-dev',
    // Steel, and the one workspace deliberately off the sweep the others sit
    // on. This is the app looking at itself rather than a place work lives,
    // and a sixth hue on the same arc would have been the first pair anyone
    // confused -- teal and green side by side in the same switcher.
    key: { shape: 'terminal', from: '#94a3b8', to: '#475569' },
    ownerOnly: true,
  },
] as const;

/**
 * The mark for the whole app: the topbar when no module is active, every
 * signed-out page, and the favicon.
 *
 * Dash at rest: the capsule visor with its glowing core, on a dark plate. It
 * is the one mark that draws no object, because the app is not one of the
 * modules; it is the assistant that works across all of them. The same
 * drawing is the favicon and the home-screen icon (app/icon.svg).
 */
export const HOME_MARK = {
  label: 'Home',
  accent: '--color-accent',
  /**
   * The app's own key, and the one place more than one hue is allowed.
   *
   * Everywhere else a gradient stays inside a single hue and lands on the
   * workspace's accent, because a many-hue ramp on a module mark is decoration
   * pretending to be identity. Here it *is* the identity: blue into pink is
   * what this product has used for itself since before it had modules, and the
   * home mark is the only thing entitled to wear it.
   *
   * It is the glowing core inside Dash's capsule visor. The violet in the
   * middle keeps the blue-to-pink ramp from passing through a dead mauve.
   */
  key: { shape: 'dash', from: '#6a82fb', mid: '#8b5cf6', to: '#ff6b9d' },
} as const;

/**
 * The modules an account is allowed to see.
 *
 * Every list of workspaces in the app draws from this rather than from
 * `MODULES` directly -- the switcher, the phone's sheet, the command palette,
 * the home tiles and the account page's checkboxes -- so that "only the owner
 * sees Dev" is one rule in one place instead of five lists that have to be
 * remembered separately. The next owner-only module is a flag on the row
 * above, and nothing else.
 *
 * The boolean is passed in rather than read here on purpose: the answer comes
 * from `lib/dev/owner.ts`, which is server-only and costs a round trip, and
 * half these callers are client components. The server reads it once per
 * render and hands it down.
 *
 * Pure, so a caller that has no idea whether it is the owner should pass
 * `false` -- that shows one workspace too few, which is a puzzle, rather than
 * one too many, which is a leak.
 */
export function modulesFor(isOwner: boolean): readonly AppModule[] {
  return isOwner ? MODULES : MODULES.filter((module) => !module.ownerOnly);
}

/** The same rule, as ids: for the places that store or compare them. */
export function moduleIdsFor(isOwner: boolean): readonly ModuleId[] {
  return modulesFor(isOwner).map((module) => module.id);
}

/**
 * The workspaces the shell offers: the ones this account switched on, minus
 * any it is not allowed to see at all.
 *
 * The switcher, the phone's sheet and the command palette are three lists of
 * one thing, so the shell works this out once and hands all three the answer.
 *
 * `enabled` undefined means "all of them", because a shell rendered before the
 * settings are known must not show an empty switcher -- a person whose
 * workspaces vanished cannot tell a bug from a setting they do not remember
 * changing. All of them still means all the ones this account may have.
 */
export function switchableModules(
  enabled: readonly ModuleId[] | undefined,
  isOwner: boolean,
): readonly ModuleId[] {
  const allowed = moduleIdsFor(isOwner);
  return (enabled ?? allowed).filter((id) => allowed.includes(id));
}

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
