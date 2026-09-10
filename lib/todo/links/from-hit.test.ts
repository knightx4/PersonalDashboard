import { describe, expect, it } from 'vitest';
import { HIT_KINDS, type HitKind } from '@/lib/search/sources';
import { isLinkTarget } from '@/lib/todo/links/model';
import {
  LINKABLE_HIT_KINDS,
  TARGET_FOR_HIT,
  isLinkable,
  targetForHit,
} from '@/lib/todo/links/from-hit';

/**
 * The crossing between what the search finds and what a task can be about.
 *
 * The table is written out by hand, so a kind added to HIT_KINDS could land
 * with no answer here and quietly never appear in the picker. Asserted rather
 * than trusted, the same way load.test.ts guards the hand-written select list.
 */
describe('the map from a hit to a target', () => {
  it('has an answer for every kind the search can find', () => {
    for (const kind of Object.keys(HIT_KINDS) as HitKind[]) {
      expect(TARGET_FOR_HIT, `${kind} has no entry in TARGET_FOR_HIT`).toHaveProperty(kind);
    }
  });

  it('names a real target wherever it names one at all', () => {
    for (const target of Object.values(TARGET_FOR_HIT)) {
      if (target === null) continue;
      expect(isLinkTarget(target)).toBe(true);
    }
  });

  it('sends a company to a company and a note to a note', () => {
    expect(targetForHit({ kind: 'company' })).toBe('company');
    expect(targetForHit({ kind: 'note' })).toBe('note');
    expect(targetForHit({ kind: 'saved' })).toBe('saved');
  });

  it('refuses a task, which is a subtask and a different feature', () => {
    expect(targetForHit({ kind: 'task' })).toBeNull();
    expect(isLinkable({ kind: 'task' })).toBe(false);
  });

  it('lists the linkable kinds and leaves the rest out', () => {
    expect(LINKABLE_HIT_KINDS).not.toContain('task');
    expect(LINKABLE_HIT_KINDS).toContain('reading');
    expect(LINKABLE_HIT_KINDS).toHaveLength(Object.keys(HIT_KINDS).length - 1);
  });
});
