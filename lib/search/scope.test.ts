import { describe, expect, it } from 'vitest';
import {
  commandsInScope,
  hitsInScope,
  inScope,
  moduleInScope,
  parseScope,
  scopeForModule,
  scopeLabel,
  toggleScope,
} from './scope';
import type { SearchHit } from './sources';

/**
 * Narrowing a search to one workspace, on the browser's side.
 *
 * The server never asks a source outside the scope, which search.test.ts
 * covers. This is the other half: the palette holds every findable row, so the
 * bar has to take the other workspaces out of that list itself, and the scope
 * has to survive the trip through a query string unchanged.
 *
 * The same rule narrows the places you can go and the things you can start, so
 * a bar set to one workspace does not offer another workspace by name either.
 */

const hit = (module: SearchHit['module'], title: string): SearchHit => ({
  module,
  kind: 'company',
  id: `${module}:${title}`,
  title,
  subtitle: null,
  href: `/${module}/${title}`,
});

const held = [hit('jobs', 'Acme'), hit('shopping', 'Acme order'), hit('jobs', 'Acorn')];

describe('filtering a held list', () => {
  it('keeps only the workspace asked for', () => {
    expect(hitsInScope(held, 'jobs').map((h) => h.title)).toEqual(['Acme', 'Acorn']);
  });

  it('keeps everything when everything was asked for', () => {
    expect(hitsInScope(held, 'everything')).toHaveLength(3);
  });

  it('returns nothing for a workspace with nothing in the list', () => {
    expect(hitsInScope(held, 'news')).toEqual([]);
  });

  it('leaves the list it was given alone', () => {
    hitsInScope(held, 'jobs');
    expect(held).toHaveLength(3);
  });

  it('answers the same one hit at a time', () => {
    expect(inScope(held[0], 'jobs')).toBe(true);
    expect(inScope(held[1], 'jobs')).toBe(false);
    expect(inScope(held[1], 'everything')).toBe(true);
  });
});

/**
 * The navigation half of the list, as the hook builds it: the sections of the
 * workspace you are in, Home, the other workspaces, Account, a theme and a
 * capture action.
 */
const commands = [
  { id: 'section:/jobs/board', label: 'Board', module: 'jobs' as const },
  { id: 'workspace:home', label: 'Home', module: null },
  { id: 'workspace:shopping', label: 'Shopping', module: 'shopping' as const },
  { id: 'go:account', label: 'Account', module: null },
  { id: 'theme:dark', label: 'Theme: Ink' },
  { id: 'capture:todo', label: 'Add a todo', module: 'todo' as const },
];

describe('filtering the places you can go', () => {
  it('keeps this workspace and drops every other one', () => {
    expect(commandsInScope(commands, 'jobs').map((c) => c.id)).toEqual(['section:/jobs/board']);
  });

  it('keeps the capture actions of the workspace asked for', () => {
    expect(commandsInScope(commands, 'todo').map((c) => c.id)).toEqual(['capture:todo']);
  });

  it('keeps everything when everything was asked for', () => {
    expect(commandsInScope(commands, 'everything')).toHaveLength(commands.length);
  });

  it('leaves the list it was given alone', () => {
    commandsInScope(commands, 'jobs');
    expect(commands).toHaveLength(6);
  });

  it('answers the same one row at a time', () => {
    // A row that belongs to no workspace -- Home, Account, a theme -- is in
    // the list only when the whole account is being searched.
    expect(moduleInScope('jobs', 'jobs')).toBe(true);
    expect(moduleInScope('shopping', 'jobs')).toBe(false);
    expect(moduleInScope(null, 'jobs')).toBe(false);
    expect(moduleInScope(undefined, 'jobs')).toBe(false);
    expect(moduleInScope(null, 'everything')).toBe(true);
    expect(moduleInScope(undefined, 'everything')).toBe(true);
  });
});

describe('the scope of the page you are on', () => {
  it('is the workspace you are standing in', () => {
    expect(scopeForModule('vault')).toBe('vault');
  });

  it('is everything outside a workspace, which is the home page', () => {
    expect(scopeForModule(null)).toBe('everything');
  });
});

describe('reading a scope out of a query string', () => {
  it('takes a workspace this app has', () => {
    expect(parseScope('learn')).toBe('learn');
  });

  it('reads a missing one as everything', () => {
    expect(parseScope(null)).toBe('everything');
    expect(parseScope(undefined)).toBe('everything');
    expect(parseScope('')).toBe('everything');
  });

  it('reads anything that is not a workspace as everything', () => {
    // The widest answer rather than an error: a link carrying a workspace that
    // has since been renamed should still find things.
    expect(parseScope('recipes')).toBe('everything');
  });

  it('carries a workspace back out as itself', () => {
    // The bar puts the scope straight into the query string, so this round
    // trip is the whole of the wire format.
    expect(parseScope(scopeForModule('jobs'))).toBe('jobs');
    expect(parseScope(scopeForModule(null))).toBe('everything');
  });
});

/**
 * The chip on the search bar: what it says, and what pressing it does.
 *
 * Two states and no more. The workspace the page is standing in, and
 * everything the account holds -- so the chip can always be read as a name of
 * what is being searched rather than as a filter that has to be remembered.
 */
describe('what the chip says', () => {
  it('names the workspace being searched', () => {
    expect(scopeLabel('jobs')).toBe('Job search');
    expect(scopeLabel('vault')).toBe('Vault');
  });

  it('names the wider setting as everything', () => {
    expect(scopeLabel('everything')).toBe('Everything');
  });
});

describe('pressing the chip', () => {
  it('widens a workspace to everything', () => {
    expect(toggleScope('jobs', 'jobs')).toBe('everything');
  });

  it('narrows back to the workspace the page is in', () => {
    expect(toggleScope('everything', 'jobs')).toBe('jobs');
  });

  it('narrows to where the page is now, not to where it was', () => {
    // The bar survives a navigation, so a chip widened in one workspace and
    // pressed again in another must come back to the second one.
    expect(toggleScope('everything', 'shopping')).toBe('shopping');
  });

  it('stays on everything outside a workspace, which is what the home page is', () => {
    // Nothing to narrow to, so both states are the same and the bar draws no
    // chip at all.
    expect(toggleScope('everything', null)).toBe('everything');
    expect(toggleScope(scopeForModule(null), null)).toBe('everything');
  });
});
