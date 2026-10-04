/**
 * The map from gallery surfaces to the pages they stand for
 * (lib/preview/routes.ts), checked against the gallery and the app's pages,
 * and against the files of screen changes that have already shipped.
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { importedBy, pagesUsing } from '@/lib/preview/importers';
import {
  routeMatches,
  routeOfFile,
  SURFACE_ROUTES,
  surfacesForFiles,
  surfacesInText,
} from '@/lib/preview/routes';
import { SPEC_COUNTERS } from '@/scripts/spec-counts';

const root = process.cwd();

/** Ids read from source, since importing the gallery renders half the app.
 * Entries sit four spaces in; fixtures nested in a render sit deeper. */
function idsIn(file: string, after: string): string[] {
  const text = readFileSync(join(root, file), 'utf8');
  return [...text.slice(text.indexOf(after)).matchAll(/^ {4}id: '([^']+)'/gm)].map((m) => m[1]);
}

const GALLERY = [
  ...idsIn('app/preview/surfaces.tsx', 'export const SURFACES'),
  ...idsIn('app/dev/ui/anatomy.tsx', 'export const ANATOMIES'),
];

function pages(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(root, dir))) {
    const path = `${dir}/${name}`;
    if (statSync(join(root, path)).isDirectory()) pages(path, out);
    else if (name === 'page.tsx') out.push(path);
  }
  return out;
}
const PAGE_ROUTES = pages('app').map((p) => routeOfFile(p));

describe('the surface routes', () => {
  it('give every gallery surface its pages, and nothing else', () => {
    expect(new Set(Object.keys(SURFACE_ROUTES))).toEqual(new Set(GALLERY));
    for (const [id, routes] of Object.entries(SURFACE_ROUTES)) {
      expect(routes.length, id).toBeGreaterThan(0);
    }
  });

  it('name only pages the app has', () => {
    for (const [id, routes] of Object.entries(SURFACE_ROUTES)) {
      for (const route of routes) expect(PAGE_ROUTES, `${id} ${route}`).toContain(route);
    }
  });
});

describe('routeOfFile', () => {
  it('drops route groups and the file, and stops at a private folder', () => {
    expect(routeOfFile('app/jobs/(app)/roles/[id]/panels.tsx')).toBe('/jobs/roles/[id]');
    expect(routeOfFile('app/jobs/(app)/_home/this-week-lists.tsx')).toBe('/jobs');
    expect(routeOfFile('app/page.tsx')).toBe('/');
    expect(routeOfFile('components/todo/day-closed.tsx')).toBeNull();
    expect(routeOfFile('app/preview/surfaces.tsx')).toBeNull();
  });

  it('matches a real address against a pattern', () => {
    expect(routeMatches('/jobs/roles/[id]', '/jobs/roles/42')).toBe(true);
    expect(routeMatches('/vault/n/[...path]', '/vault/n/a/b')).toBe(true);
    expect(routeMatches('/jobs/roles/[id]', '/jobs/roles')).toBe(false);
    expect(routeMatches('/jobs/roles/[id]', '/jobs', true)).toBe(true);
  });
});

describe('surfacesForFiles, on screen changes that shipped', () => {
  const graph = importedBy(root);
  const using = (file: string) => pagesUsing(file, graph);

  it('names Quick read for the end-of-Quick-read change (b5c6e3db)', () => {
    const found = surfacesForFiles(
      [
        'app/dev/ui/got-through-demo.tsx',
        'app/dev/ui/page.tsx',
        'app/news/page.tsx',
        'app/news/quick/got-through.tsx',
        'app/news/quick/quick-view.tsx',
        'app/preview/surfaces.tsx',
      ],
      using,
    );
    expect(found).toEqual(
      expect.arrayContaining(['news-quick-got-through', 'news-quick-story', 'dev-ui']),
    );
    expect(found).not.toContain('news-saved');
    expect(found).not.toContain('dev-surfaces');
  });

  it('follows a component to the page that uses it (20a8a7c7)', () => {
    expect(surfacesForFiles(['components/jobs/pipeline/board.tsx'], using)).toEqual([
      'jobs-pipeline-board',
      'jobs-pipeline-dense',
      'jobs-pipeline-list',
    ]);
    expect(surfacesForFiles(['components/jobs/pipeline/board.tsx'])).toEqual([]);
  });

  it('names the Todo moments for the day-close change (d12fc78b)', () => {
    const found = surfacesForFiles(['app/todo/page.tsx', 'components/todo/day-closed.tsx'], using);
    expect(found).toEqual(['todo-day-close', 'todo-day-closed']);
  });

  it('ignores files that are not screens', () => {
    expect(surfacesForFiles(['lib/jobs/today/load.ts', 'app/news/actions.ts'], using)).toEqual([]);
  });
});

describe('surfacesInText', () => {
  it('reads addresses, gallery links and screen files', () => {
    expect(surfacesInText('Show the date on /news/saved.')).toEqual(['news-saved', 'news-saved-empty']);
    expect(surfacesInText('See /preview?s=dev-ui for it.')).toEqual(['dev-ui']);
    expect(surfacesInText('Change app/todo/page.tsx')).toEqual(['todo-day-close', 'todo-day-closed']);
    expect(surfacesInText('open /jobs/roles/42')).toEqual(
      Object.keys(SURFACE_ROUTES).filter((id) => SURFACE_ROUTES[id].includes('/jobs/roles/[id]')),
    );
    expect(surfacesInText('Edit app/preview/surfaces.tsx and docs/UI-QUALITY-SPEC.md')).toEqual([]);
  });
});

describe('the routes-without-surface counter (docs/UI-QUALITY-SPEC.md R1)', () => {
  const counter = SPEC_COUNTERS.find((c) => c.name === 'routes-without-surface')!;

  it('counts a new page with no gallery entry, and not one that has an entry or only redirects', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'routes-without-surface-'));
    const write = (file: string, text: string) => {
      mkdirSync(dirname(join(fixture, file)), { recursive: true });
      writeFileSync(join(fixture, file), text);
    };
    try {
      write('app/(app)/brand-new/page.tsx', 'export default function P() {\n  return <p>new</p>;\n}\n');
      write('app/news/saved/page.tsx', 'export default function P() {\n  return <p>saved</p>;\n}\n');
      write('app/old/page.tsx', "import { redirect } from 'next/navigation';\nexport default function P() {\n  redirect('/news');\n}\n");
      write('app/api/thing/route.ts', 'export function GET() {}\n');
      write('app/preview/page.tsx', 'export default function P() {\n  return null;\n}\n');
      expect(counter.measure(fixture)).toEqual(['/brand-new']);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
});
