import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { surfaceOfComponent } from './routes';

/**
 * The pages a component reaches through the files that import it.
 *
 * lib/preview/routes.ts maps a file under `app/` to its page by path, but a
 * screen is as often changed in `components/`: the pipeline board, the day
 * closing on Todo. This follows imports upward from such a file until it
 * reaches the pages and layouts that use it, so the routes can name their
 * surfaces. It reads the source tree, so it runs from the plan CLI and the
 * tests, never from the app.
 *
 * The gallery's own files (`app/preview/`) and the /dev/ui demos import
 * components to draw them, not to serve a page, and are not followed.
 */

const ROOTS = ['app', 'components', 'lib'];
const EXTENSIONS = ['', '.tsx', '.ts', '/index.tsx', '/index.ts'];

function sourceFiles(root: string, dir: string, out: string[]): void {
  const full = join(root, dir);
  if (!existsSync(full)) return;
  for (const name of readdirSync(full)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const path = join(dir, name);
    if (statSync(join(root, path)).isDirectory()) sourceFiles(root, path, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(path);
  }
}

function resolveSpecifier(root: string, from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith('@/')) base = spec.slice(2);
  else if (spec.startsWith('.')) base = relative(root, join(root, dirname(from), spec));
  else return null;
  for (const ext of EXTENSIONS) {
    const candidate = base + ext;
    if (existsSync(join(root, candidate)) && statSync(join(root, candidate)).isFile()) {
      return candidate.split('\\').join('/');
    }
  }
  return null;
}

/** `import type { … } from '…'` and `export type { … } from '…'`, whole. */
const TYPE_ONLY_IMPORT = /\b(?:import|export)\s+type\s[^;]*?\bfrom\s+['"][^'"]+['"]/g;

/** Files that import each file, keyed by repository-relative path. */
export function importedBy(root: string): Map<string, string[]> {
  const files: string[] = [];
  for (const dir of ROOTS) sourceFiles(root, dir, files);
  const map = new Map<string, string[]>();
  const pattern = /(?:\bfrom\s+|\bimport\s*\(?\s*)['"]([^'"]+)['"]/g;
  for (const file of files) {
    const from = file.split('\\').join('/');
    // A type-only import draws nothing, so it is not a way for a change to
    // reach a page: lib/raised/notifications.ts takes the Notification type
    // from the shell's bell, and through it every layout reached the bell.
    const text = readFileSync(join(root, file), 'utf8').replace(TYPE_ONLY_IMPORT, '');
    for (const m of text.matchAll(pattern)) {
      const target = resolveSpecifier(root, from, m[1]);
      if (!target || target === from) continue;
      const list = map.get(target) ?? [];
      if (!list.includes(from)) list.push(from);
      map.set(target, list);
    }
  }
  return map;
}

/** Files that import to draw rather than to serve a page. */
function isGallery(file: string): boolean {
  return file.startsWith('app/preview/') || /^app\/dev\/ui\/[^/]*-demo\.tsx$/.test(file);
}

/**
 * The pages and layouts under `app/` that use `file`, directly or through
 * other files. Pass the map from `importedBy` once and reuse it.
 *
 * The walk stops at a shared component with a surface of its own
 * (COMPONENT_SURFACES in routes.ts, plan #1708): that file is returned in
 * place of the pages above it, and surfacesForFiles names its surface.
 */
export function pagesUsing(file: string, graph: Map<string, string[]>): string[] {
  const pages = new Set<string>();
  const seen = new Set<string>([file]);
  const queue = [file];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const importer of graph.get(current) ?? []) {
      if (seen.has(importer) || isGallery(importer)) continue;
      seen.add(importer);
      if (surfaceOfComponent(importer)) {
        pages.add(importer);
        continue;
      }
      if (/^app\/.*\/?(page|layout)\.tsx$/.test(importer)) pages.add(importer);
      queue.push(importer);
    }
  }
  return [...pages].sort();
}
