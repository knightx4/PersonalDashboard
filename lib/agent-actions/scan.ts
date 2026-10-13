import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * Finds the server actions the catalogue has to list: every function exported
 * from a module under app/ whose first statement is `'use server'`. Not only
 * the files named actions.ts, since a page can put its actions in
 * `comment-actions.ts` or `theme-actions.ts` just as well.
 *
 * Read by lib/agent-actions/catalogue.test.ts. It reads the repository, so it
 * is for tests and scripts, never for a page.
 */

/** Whether a module's first statement, past comments, is the `'use server'` directive. */
export function isServerModule(source: string): boolean {
  const rest = source.replace(/^(?:\s+|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*/, '');
  return /^(['"])use server\1/.test(rest);
}

/** The names a module exports as values, which in a `'use server'` module are its actions. */
export function exportedActions(source: string): string[] {
  const names = new Set<string>();
  for (const m of source.matchAll(/^export\s+(?:async\s+)?function\s*\*?\s*(\w+)/gm))
    names.add(m[1]);
  for (const m of source.matchAll(/^export\s+(?:const|let|var)\s+(\w+)/gm)) names.add(m[1]);
  for (const m of source.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const part of m[1].split(',')) {
      const spec = part.trim();
      if (!spec || spec.startsWith('type ')) continue;
      names.add(
        spec
          .split(/\s+as\s+/)
          .pop()!
          .trim(),
      );
    }
  }
  if (/^export\s+default\b/m.test(source)) names.add('default');
  return [...names].sort();
}

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(path);
  }
}

/** Every server action under `root`/app, as `{ file, name }` with the file from `root`. */
export function serverActions(root: string): { file: string; name: string }[] {
  const files: string[] = [];
  walk(join(root, 'app'), files);
  const found: { file: string; name: string }[] = [];
  for (const path of files.sort()) {
    const source = readFileSync(path, 'utf8');
    if (!isServerModule(source)) continue;
    const file = relative(root, path).split(sep).join('/');
    for (const name of exportedActions(source)) found.push({ file, name });
  }
  return found;
}
