/**
 * The registry is the framework: a quick action is a row here, and the panel,
 * the shortcut and the palette read it. So what is worth asserting is that a
 * row is usable by all three -- it has a name, a field, an empty-state, and
 * words that find it.
 */
import { describe, expect, it } from 'vitest';
import { score } from '@/lib/search/score';
import {
  CAPTURE_ACTIONS,
  DEFAULT_CAPTURE_ACTION,
  captureAction,
  captureHaystack,
} from '@/lib/capture/actions';

describe('the capture actions', () => {
  it('gives every action a name, a field and something to type into', () => {
    for (const action of CAPTURE_ACTIONS) {
      expect(action.label.length).toBeGreaterThan(0);
      expect(action.placeholder.length).toBeGreaterThan(0);
      expect(['line', 'prose']).toContain(action.field);
      expect(typeof action.dated).toBe('boolean');
      expect(action.keywords.length).toBeGreaterThan(0);
    }
  });

  it('uses each id once, since the id is what the palette hands the panel', () => {
    const ids = CAPTURE_ACTIONS.map((action) => action.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('resolves the one the shortcut opens', () => {
    expect(captureAction(DEFAULT_CAPTURE_ACTION)).not.toBeNull();
  });

  it('answers nothing for an id it does not have, rather than a stand-in', () => {
    expect(captureAction('note')).toBeNull();
  });

  it('is found by what somebody actually types', () => {
    const todo = captureAction('todo');
    expect(todo).not.toBeNull();
    const haystack = captureHaystack(todo!);
    for (const typed of ['add todo', 'todo', 'task', 'new task']) {
      expect(score(haystack, typed)).not.toBeNull();
    }
  });
});
