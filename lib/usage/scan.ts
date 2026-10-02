import { readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every page under app/, as the route pattern Next serves it at: route groups
 * such as `(app)` removed, private `_folders` left out, dynamic segments kept
 * as written (`/learn/s/[id]`).
 *
 * Node only. scripts/pages-write.ts writes the result into lib/usage/pages.ts,
 * which proxy.ts can import without touching the file system, and
 * lib/usage/pages.test.ts checks the two still agree.
 */
export function scanPageRoutes(appDir: string): string[] {
  const routes: string[] = [];

  function walk(dir: string, segments: string[]): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile() && /^page\.(tsx|ts|jsx|js|mdx)$/.test(entry.name)) {
        routes.push(`/${segments.join('/')}`);
      } else if (entry.isDirectory()) {
        const name = entry.name;
        if (name.startsWith('_') || name.startsWith('@')) continue;
        const isGroup = name.startsWith('(') && name.endsWith(')');
        walk(join(dir, name), isGroup ? segments : [...segments, name]);
      }
    }
  }

  walk(appDir, []);
  return [...new Set(routes)].sort();
}
