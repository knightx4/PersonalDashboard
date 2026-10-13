import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COMPONENT_SURFACES, surfacesForFiles } from './routes';

describe('the shared components', () => {
  it('are each looked at on a surface of their own', () => {
    // When this fails, a file was added to components/ui: add it to `ui-kit`
    // in COMPONENT_SURFACES and draw it in app/preview/ui-kit-surface.tsx.
    const covered = new Set(Object.values(COMPONENT_SURFACES).flat());
    const files = readdirSync(join(process.cwd(), 'components/ui'))
      .filter((name) => name.endsWith('.tsx'))
      .map((name) => `components/ui/${name}`);
    expect(files.filter((file) => !covered.has(file))).toEqual([]);
  });

  it('stop the walk at that surface instead of naming every page', () => {
    const everything = () => ['app/jobs/(app)/roles/[id]/page.tsx', 'app/learn/page.tsx'];
    expect(surfacesForFiles(['components/ui/button.tsx'], everything)).toEqual(['ui-kit']);
  });
});
