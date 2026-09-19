import { describe, expect, it } from 'vitest';
import { hitsInScope, inScope, parseScope, scopeForModule } from './scope';
import type { SearchHit } from './sources';

/**
 * Narrowing a search to one workspace, on the browser's side.
 *
 * The server never asks a source outside the scope, which search.test.ts
 * covers. This is the other half: the palette holds every findable row, so the
 * bar has to take the other workspaces out of that list itself, and the scope
 * has to survive the trip through a query string unchanged.
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
