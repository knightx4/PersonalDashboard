/**
 * Every page in the shell picks one of the two widths in
 * components/shell/page-width.tsx: PageColumn for one column, PageWide for a
 * page with a second column beside the main one. A page that picks neither
 * stretches to the shell's 1400px, which is how seventeen one-column pages
 * came to be wider than Plan while the pages next to them were narrower.
 *
 * Read from source. A page is found by the header it draws: a file under app/
 * that renders <PageHeader> has to choose a width itself, sit under a layout
 * that does, or be one of the pieces below that a framed page draws.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

/** The wrappers, and the patterns that hold one inside them. */
const CHOOSES = /<(PageColumn|PageWide|MainRail|TabbedDetail|ListPage|DetailPage)\b/;

/** Not in the shell, or drawn by the gallery at the width it is judged at. */
const OUTSIDE = [/^app\/preview\//, /^app\/dev\/ui\//, /^app\/\(legal\)\//, /^app\/s\//, /^app\/page\.tsx$/];

/** Pieces with a header of their own, each drawn inside a page that has a width. */
const DRAWN_INSIDE: Record<string, string> = {
  'app/goals/goals-view.tsx': 'app/goals/all/page.tsx and app/goals/area/[areaId]/page.tsx',
  'app/learn/now/header.tsx': 'app/learn/now/page.tsx',
  'app/learn/topics/draft-form.tsx': 'app/learn/topics/topics-view.tsx',
  'app/learn/topics/review/move-runner.tsx': 'app/learn/topics/review/review-view.tsx',
  'app/shopping/review/review-list.tsx': 'app/shopping/review/page.tsx',
  'app/jobs/(app)/review/list.tsx': 'app/jobs/(app)/review/page.tsx',
};

function tsxFiles(dir: string): string[] {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return tsxFiles(path);
    return entry.name.endsWith('.tsx') ? [path] : [];
  });
}

/**
 * A layout chooses for the pages under it when it draws a wrapper, or when it
 * is the account's chrome: shellFor with no module draws its pages in
 * PageColumn (lib/shell/shell-for.tsx). A page that calls shellFor itself
 * chooses the same way.
 */
const LAYOUT_CHOOSES = /<(PageColumn|PageWide)\b|shellFor\(\{\s*module: null|narrow: true/;

function layoutChooses(file: string): boolean {
  for (let dir = dirname(file); dir !== '.' && dir !== ''; dir = dirname(dir)) {
    const layout = join(root, dir, 'layout.tsx');
    if (existsSync(layout) && LAYOUT_CHOOSES.test(readFileSync(layout, 'utf8'))) return true;
  }
  return false;
}

const pages = tsxFiles('app')
  .map((file) => relative(root, join(root, file)))
  .filter((file) => !OUTSIDE.some((pattern) => pattern.test(file)))
  .filter((file) => readFileSync(join(root, file), 'utf8').includes('<PageHeader'));

describe('page widths', () => {
  it('finds the pages', () => {
    expect(pages.length).toBeGreaterThan(100);
  });

  it('gives every page in the shell PageColumn or PageWide', () => {
    const without = pages.filter(
      (file) =>
        !(file in DRAWN_INSIDE) &&
        !CHOOSES.test(readFileSync(join(root, file), 'utf8')) &&
        !LAYOUT_CHOOSES.test(readFileSync(join(root, file), 'utf8')) &&
        !layoutChooses(file),
    );
    expect(without, 'pages with no width: wrap each in PageColumn or PageWide').toEqual([]);
  });

  it('lists only pieces that still draw a header', () => {
    for (const file of Object.keys(DRAWN_INSIDE)) expect(pages, file).toContain(file);
  });
});
