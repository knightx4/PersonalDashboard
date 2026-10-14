import { describe, expect, it } from 'vitest';
import { backTarget, hitHref, listAddress, parentCrumb, safeFrom, withFrom } from './back-from';

const path = [
  { label: 'Jobs', href: '/jobs' },
  { label: 'Contacts', href: '/jobs/contacts' },
  { label: 'Ada Lovelace', href: '/jobs/contacts/c1' },
];

describe('safeFrom', () => {
  it('takes a path on this site, query and all', () => {
    expect(safeFrom('/jobs/contacts?q=ada&sort=name')).toBe('/jobs/contacts?q=ada&sort=name');
  });

  it('refuses anything that could leave the site', () => {
    for (const bad of [
      'https://evil.example',
      '//evil.example/x',
      '/\\evil.example',
      'javascript:alert(1)',
      'jobs/contacts',
      '/jobs\n/x',
      '',
      null,
      undefined,
      `/${'a'.repeat(3000)}`,
    ]) {
      expect(safeFrom(bad)).toBeNull();
    }
  });
});

describe('listAddress and withFrom', () => {
  it('carries the list with its query, less any from of its own', () => {
    expect(listAddress('/jobs/contacts', '?q=ada&from=%2Fhome')).toBe('/jobs/contacts?q=ada');
    expect(listAddress('/jobs/contacts', '')).toBe('/jobs/contacts');
  });

  it('puts the list on a row link, keeping the row link’s own query and fragment', () => {
    expect(withFrom('/jobs/contacts/c1', '/jobs/contacts?q=ada')).toBe(
      '/jobs/contacts/c1?from=%2Fjobs%2Fcontacts%3Fq%3Dada',
    );
    expect(withFrom('/goals/g1?tab=steps#s2', '/goals/all')).toBe('/goals/g1?tab=steps&from=%2Fgoals%2Fall#s2');
  });

  it('leaves a link elsewhere, a bad from and a link to the list itself alone', () => {
    expect(withFrom('https://example.com', '/goals/all')).toBe('https://example.com');
    expect(withFrom('/goals/g1', '//evil.example')).toBe('/goals/g1');
    expect(withFrom('/goals/all?q=x', '/goals/all')).toBe('/goals/all?q=x');
  });

  it('opens a search hit with the page it was found from', () => {
    expect(hitHref('/goals/g1', { pathname: '/goals/all', search: '?q=run' })).toBe(
      '/goals/g1?from=%2Fgoals%2Fall%3Fq%3Drun',
    );
  });
});

describe('backTarget', () => {
  it('goes to the list named by from, labelled with the part of the path it is', () => {
    expect(backTarget('/jobs/contacts?q=ada', path, parentCrumb(path))).toEqual({
      label: 'Contacts',
      href: '/jobs/contacts?q=ada',
    });
  });

  it('calls a list off the path Back', () => {
    expect(backTarget('/home', path, parentCrumb(path))).toEqual({ label: 'Back', href: '/home' });
  });

  it('falls back to the parent, or to nothing', () => {
    expect(backTarget(null, path, parentCrumb(path))).toEqual(path[1]);
    expect(backTarget('https://evil.example', path, parentCrumb(path))).toEqual(path[1]);
    expect(backTarget(null, path, null)).toBeNull();
    expect(parentCrumb(path.slice(0, 1))).toBeNull();
  });
});
