import { MODULE_IDS, MODULES, type ModuleId } from '@/lib/modules';

/**
 * Which module a source file belongs to, or `shared` when it belongs to none.
 *
 * The design gate counts violations per file and reports one number for the
 * whole app, which stopped saying anything the moment that number reached
 * zero. "Is the vault in line" and "has anybody looked at learn" are questions
 * about one module, and answering them needs the file the gate already has in
 * its hand to be attributable to a module.
 *
 * `shared` is a real answer rather than a gap: the shell, the primitives, the
 * account pages and the auth routes are not any module's, and a file that
 * matches nothing at all lands there too. That is deliberate -- a file with no
 * home must still be scanned and still be counted, because dropping it is how
 * a whole directory goes unreviewed without anybody noticing.
 */
export type UiScope = ModuleId | 'shared';

/** Every scope, modules in their usual order and shared last. */
export const UI_SCOPES: readonly UiScope[] = [...MODULE_IDS, 'shared'];

/**
 * Directories that belong to a module but are not named after it.
 *
 * `app/<id>/` is derived from the module's own prefix below, so only the
 * exceptions are written here: the component directories, which are named
 * after the thing they draw rather than after the workspace, and the two
 * routes that sit outside their module's tree.
 */
const EXTRA_PREFIXES: ReadonlyArray<readonly [string, ModuleId]> = [
  // The anonymous share page hangs off the root so its links stay short, but
  // everything on it is shopping's.
  ['app/s/', 'shopping'],
  ['components/dashboard/', 'shopping'],
  ['components/inventory/', 'shopping'],
  ['components/merchants/', 'shopping'],
  ['components/orders/', 'shopping'],
  // Whose order it is, drawn on shopping's rows and nowhere else.
  ['components/people/', 'shopping'],
  ['components/share/', 'shopping'],
  ['components/jobs/', 'jobs'],
  ['components/learn/', 'learn'],
  ['components/todo/', 'todo'],
  ['components/vault/', 'vault'],
  // The bug queue and the routine buttons on it, which live under /dev.
  ['components/feedback/', 'dev'],
  // The preview harness the review's shots are taken from.
  ['app/preview/', 'dev'],
];

const PREFIXES: ReadonlyArray<readonly [string, ModuleId]> = [
  ...MODULES.map((module) => [`app${module.prefix}/`, module.id] as const),
  ...EXTRA_PREFIXES,
].sort(([a], [b]) => b.length - a.length);

/**
 * The module a repository-relative path belongs to.
 *
 * Longest prefix wins, so a directory inside a module's tree can be given to
 * something else later without reordering the table.
 */
export function scopeForFile(path: string): UiScope {
  const file = path.replace(/^\.\//, '');
  for (const [prefix, id] of PREFIXES) {
    if (file.startsWith(prefix)) return id;
  }
  return 'shared';
}
