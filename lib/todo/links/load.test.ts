import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LINK_TARGETS, TARGET_COLUMNS } from '@/lib/todo/links/model';

/**
 * The select list in load.ts is written out by hand because supabase-js parses
 * it at the type level and a computed string degrades the result to an error
 * type. Written out means it can fall behind the target list -- a seventh
 * target would be added to the model, the migration and the form, and simply
 * never come back from this query, with nothing failing anywhere.
 *
 * So it is asserted rather than trusted.
 */
describe('the hand-written select list', () => {
  it('names every target column', () => {
    const source = readFileSync(new URL('./load.ts', import.meta.url), 'utf8');
    const select = source.match(/'task_id, relation,[^']*'/)?.[0] ?? '';

    for (const target of LINK_TARGETS) {
      expect(select, `${target} is missing from the select list in load.ts`).toContain(
        TARGET_COLUMNS[target],
      );
    }
  });
});
