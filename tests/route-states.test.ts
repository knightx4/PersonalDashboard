/**
 * Every route group has not-found, error and loading files (plan #1923, R10
 * of docs/ONE-INTERFACE-SPEC.md).
 *
 * A route group here is a folder under app/ whose layout mounts the shell.
 * Next draws a segment's not-found.tsx, error.tsx and loading.tsx inside that
 * segment's layout, so a group holding all three shows a missing row, a
 * failed page and a slow one with the sidebar and a way back. A group missing
 * one falls through to the nearest file above it, which sits outside the
 * shell, or to Next's own page.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const APP = join(ROOT, 'app');

/** Every folder under app/ whose layout.tsx mounts the AppShell. */
function shellGroups(dir = APP): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const folder = join(dir, entry.name);
    if (relative(APP, folder) === 'preview' || relative(APP, folder) === 'api') continue;
    const layout = join(folder, 'layout.tsx');
    if (existsSync(layout) && readFileSync(layout, 'utf8').includes('<AppShell')) {
      found.push(relative(ROOT, folder));
    }
    found.push(...shellGroups(folder));
  }
  return found.sort();
}

const groups = shellGroups();

describe('route states', () => {
  it('finds the route groups that mount the shell', () => {
    // A floor rather than a list, so a new workspace is checked without
    // editing this file. These are the ones the step was written against.
    for (const group of ['app/news', 'app/learn', 'app/goals', 'app/dev', 'app/mail']) {
      expect(groups).toContain(group);
    }
  });

  it.each(groups)('%s has not-found.tsx, error.tsx and loading.tsx', (group) => {
    const missing = ['not-found.tsx', 'error.tsx', 'loading.tsx'].filter(
      (file) => !existsSync(join(ROOT, group, file)),
    );
    expect(missing).toEqual([]);
  });

  it.each(groups)('%s says a missing row is no longer there, and fails in RouteError', (group) => {
    expect(readFileSync(join(ROOT, group, 'not-found.tsx'), 'utf8')).toContain('<NoLongerThere');
    expect(readFileSync(join(ROOT, group, 'error.tsx'), 'utf8')).toContain('<RouteError');
  });
});
