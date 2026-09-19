import { isModuleId, type ModuleId } from '@/lib/modules';
import type { SearchHit } from '@/lib/search/sources';

/**
 * What a search was asked for: one workspace, or everything you own.
 *
 * The command box has only ever searched everything, and the bar in the top
 * bar searches the workspace you are standing in until you press its chip. So
 * every caller from here on says which of the two it wants, and `'everything'`
 * is what the box has always done.
 *
 * A string union rather than an object, because the same value has to survive
 * a query string: `/api/search?q=acme&in=jobs` is the scope written out, and
 * `parseScope` reads it back. An object would need a shape on each side and
 * two of them to keep in step.
 *
 * Types and pure functions, no `server-only`: the browser filters the list it
 * holds with the same rule the server runs the sources with.
 */
export type SearchScope = ModuleId | 'everything';

/** The query-string parameter the scope travels in. */
export const SCOPE_PARAM = 'in';

/**
 * The scope a page is standing in.
 *
 * The shell holds `ModuleId | null`, where null is the home page and the
 * pages outside a workspace. Those search everything, because there is no
 * workspace there to narrow to.
 */
export function scopeForModule(module: ModuleId | null): SearchScope {
  return module ?? 'everything';
}

/**
 * A scope out of what arrived in a query string.
 *
 * Anything that is not a workspace this app has reads as everything, which is
 * the widest answer rather than an error page: a stale link with a workspace
 * that has since been renamed should still find things.
 */
export function parseScope(value: string | null | undefined): SearchScope {
  return value && isModuleId(value) ? value : 'everything';
}

/**
 * Whether a row belonging to this workspace may appear in a search asked for
 * this scope.
 *
 * The one rule both halves of a search box are narrowed by. A row with no
 * workspace -- Home, Account, a theme -- is out of every scope but
 * `'everything'`, which is what #720 settled: with the chip on a workspace the
 * list is that workspace's rows and nothing else.
 */
export function moduleInScope(module: ModuleId | null | undefined, scope: SearchScope): boolean {
  return scope === 'everything' || module === scope;
}

/** Whether one hit belongs in a search asked for this scope. */
export function inScope(hit: SearchHit, scope: SearchScope): boolean {
  return moduleInScope(hit.module, scope);
}

/**
 * The rows of a held list that a scoped search may show.
 *
 * The browser's half of narrowing. The palette holds every findable row and
 * matches it against each keystroke, so a bar set to one workspace is that
 * list with the other workspaces taken out before it is ranked -- ranking
 * first would spend the caps in rank.ts on rows about to be dropped.
 */
export function hitsInScope(hits: readonly SearchHit[], scope: SearchScope): SearchHit[] {
  return scope === 'everything' ? [...hits] : hits.filter((hit) => inScope(hit, scope));
}

/**
 * The places to go and the things to start that a scoped search may show.
 *
 * The other half of the same list: the sections of the workspace you are in,
 * Home, the other workspaces, Account, the themes and the capture actions. A
 * scoped search keeps only the rows of the workspace it names, so a bar
 * narrowed to one workspace offers no other workspace by name, no page of one
 * and nothing you could start in one.
 *
 * Structural rather than typed to the command, so the shape that carries these
 * rows can stay in the component that builds them.
 */
export function commandsInScope<T extends { module?: ModuleId | null }>(
  commands: readonly T[],
  scope: SearchScope,
): T[] {
  return scope === 'everything'
    ? [...commands]
    : commands.filter((command) => moduleInScope(command.module, scope));
}
