/**
 * The registry is the framework: a quick action is a row here, and the panel,
 * the shortcut and the palette read it. So what is worth asserting is that a
 * row is usable by all three -- it has a name, a field, an empty-state, and
 * words that find it.
 */
import { describe, expect, it } from 'vitest';
import { score } from '@/lib/search/score';
import {
  aimProblem,
  availableCaptureActions,
  CAPTURE_ACTIONS,
  CAPTURE_KINDS,
  DEFAULT_CAPTURE_ACTION,
  captureAction,
  captureHaystack,
  kindForPlace,
  matchCaptureActions,
} from '@/lib/capture/actions';
import { CAPTURE_PLACES } from '@/lib/capture/sort';

describe('the capture kinds an Add button aims at', () => {
  it('keys each kind by its own id, with a title field, a section and a panel action', () => {
    for (const [id, kind] of Object.entries(CAPTURE_KINDS)) {
      expect(kind.id).toBe(id);
      expect(kind.label.length).toBeGreaterThan(0);
      expect(kind.placeholder.length).toBeGreaterThan(0);
      expect(kind.section.startsWith('/')).toBe(true);
      expect(captureAction(kind.action)).not.toBeNull();
    }
  });

  it('has one kind for every place the sort files into, so the box and an aimed add make rows the same way', () => {
    for (const place of CAPTURE_PLACES) expect(kindForPlace(place).place).toBe(place);
  });

  it('refuses a note aimed at no role, and takes a todo as it is', () => {
    expect(aimProblem({ kind: 'job-note' })).not.toBeNull();
    expect(aimProblem({ kind: 'job-note', role: { id: 'r', title: 'Analyst', company: null } })).toBeNull();
    expect(aimProblem({ kind: 'todo' })).toBeNull();
  });
});

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
    // The one box belongs to no workspace, so every account has it.
    expect(ids(['todo'])).toEqual(['anything', 'todo']);
    expect(ids(['todo', 'goals'])).toEqual(['anything', 'todo', 'goals']);
    expect(ids(undefined)).toEqual(CAPTURE_ACTIONS.map((action) => action.id));
  });

  it('opens the one box from the shortcut, with no workspace of its own', () => {
    expect(DEFAULT_CAPTURE_ACTION).toBe('anything');
    expect(captureAction('anything')).toMatchObject({ module: null, field: 'prose', dated: false });
  });

  it('offers a quick note for the vault to an account that has the vault (note 4a7935d3)', () => {
    expect(availableCaptureActions(['vault']).map((action) => action.id)).toEqual(['anything', 'vault']);
    expect(captureAction('vault')).toMatchObject({ module: 'vault', field: 'prose', dated: false });
    const [match] = matchCaptureActions('quick note');
    expect(match!.action.id).toBe('vault');
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
