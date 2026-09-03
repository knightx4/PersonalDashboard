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

export type ModuleId = 'shopping' | 'jobs' | 'vault';

export type AppModule = {
  id: ModuleId;
  /** Path prefix that means "you are in this module". */
  prefix: string;
  /** Where switching to it lands: the page answering "what is going on". */
  home: string;
  label: string;
  description: string;
  gradient: string;
};

export const MODULES: readonly AppModule[] = [
  {
    id: 'shopping',
    prefix: '/shopping',
    home: '/shopping/dashboard',
    label: 'Shopping',
    description: 'Orders, inventory, returns and resale',
    // Warm, and the only mark that does not start on brand blue -- the two
    // module marks sit next to the home mark rather than under it, so they
    // read best when they are not variations on the same first colour.
    gradient:
      'linear-gradient(135deg, var(--color-accent-orange) 0%, var(--color-accent-pink) 100%)',
  },
  {
    id: 'jobs',
    prefix: '/jobs',
    home: '/jobs/today',
    label: 'Job search',
    description: 'Pipeline, roles, companies and interviews',
    gradient: 'linear-gradient(135deg, var(--color-brand) 0%, var(--color-status-final) 100%)',
  },
  {
    id: 'vault',
    prefix: '/vault',
    // The note list, not settings: "what is in here" is the question this
    // workspace answers, and it is the only page it has that answers one.
    home: '/vault',
    label: 'Vault',
    description: 'Your Obsidian notes, mirrored and searchable',
    gradient: 'linear-gradient(135deg, var(--color-brand) 0%, var(--color-accent-orange) 100%)',
  },
] as const;

/**
 * The mark for the whole app, on the largest icon in the topbar and on the
 * button when no module is active.
 *
 * Blue into pink, which is what the signed-out pages -- the marketing page,
 * sign-in, onboarding -- have always used for the product itself. It belongs
 * on the icon that means "the whole thing" rather than on one of the modules
 * inside it.
 */
export const HOME_MARK = {
  label: 'Home',
  gradient: 'linear-gradient(135deg, var(--color-brand) 0%, var(--color-accent-pink) 100%)',
} as const;

export function moduleById(id: ModuleId | null): AppModule | null {
  if (id === null) return null;
  return MODULES.find((module) => module.id === id) ?? null;
}
