/**
 * The registry is the framework: a quick action is a row here, and the panel,
 * the shortcut and the palette read it. So what is worth asserting is that a
 * row is usable by all three -- it has a name, a field, an empty-state, and
 * words that find it.
 */
import { describe, expect, it } from 'vitest';
import { score } from '@/lib/search/score';
import {
  availableCaptureActions,
  CAPTURE_ACTIONS,
  DEFAULT_CAPTURE_ACTION,
  captureAction,
  captureHaystack,
  matchCaptureActions,
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

  it('offers an action only to an account that has its workspace', () => {
    const ids = (modules?: Parameters<typeof availableCaptureActions>[0]) =>
      availableCaptureActions(modules).map((action) => action.id);
    expect(ids(['todo'])).toEqual(['todo']);
    expect(ids(['todo', 'goals'])).toEqual(['todo', 'goals']);
    expect(ids(undefined)).toEqual(CAPTURE_ACTIONS.map((action) => action.id));
  });

  it('finds logging what happened by the words for it', () => {
    for (const typed of ['log what happened', 'log progress']) {
      const [match] = matchCaptureActions(typed);
      expect(match!.action.id).toBe('goals');
      expect(match!.seed).toBe('');
    }
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

/**
 * The palette is the picker: what it has to work out from a typed line is
 * which action was named and what of the line was the thing being filed.
 */
describe('what a palette query names', () => {
  it('names the action, and keeps the rest as what to file', () => {
    const [match] = matchCaptureActions('add todo ring the dentist');
    expect(match.action.id).toBe('todo');
    expect(match.seed).toBe('ring the dentist');
  });

  it('takes the whole name before the thing, not the first word that matched', () => {
    // "new" alone matches, and stopping there would seed the panel with
    // "task call mum" -- the name of the action, in the todo.
    expect(matchCaptureActions('new task call mum')[0].seed).toBe('call mum');
  });

  it('leaves an empty field when the query is only the name', () => {
    expect(matchCaptureActions('add todo')[0].seed).toBe('');
  });

  it('names nothing on an empty query, so the palette stays a list of places', () => {
    expect(matchCaptureActions('')).toEqual([]);
    expect(matchCaptureActions('   ')).toEqual([]);
  });

  it('names nothing when the query is about something else entirely', () => {
    expect(matchCaptureActions('acme corp')).toEqual([]);
  });
});
