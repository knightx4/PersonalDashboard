import { describe, expect, it } from 'vitest';
import type { JevChoiceAnswer, JevResult } from '@/lib/jev/wire';
import {
  NO_MATCH,
  TRIAGE_MODULE_OPTIONS,
  duplicateQuestion,
  matchHref,
  readTriage,
  triageFrom,
  triageState,
  triageView,
  type TriageCandidate,
} from './triage';

function choice(label: string, confidence: number): JevResult<JevChoiceAnswer> {
  return {
    ok: true,
    model: 'jev-1.13.0',
    answer: { type: 'choice', choice: label, confidence, probabilities: { [label]: confidence } },
  };
}

const CANDIDATES: TriageCandidate[] = [
  { table: 'feedback_items', id: 'n1', body: 'should be able to link a goal step to todo' },
  {
    table: 'ideas',
    id: 'i1',
    body: 'Email the morning brief as well as sending it to the phone\nMore detail.',
  },
];

describe('duplicateQuestion', () => {
  it('offers none and one short key per open item, with no ids in the text', () => {
    const { question, keys } = duplicateQuestion(CANDIDATES);
    expect(Object.keys(question.options)).toEqual([NO_MATCH, 'item1', 'item2']);
    expect(question.options.item2).toBe(
      'Email the morning brief as well as sending it to the phone',
    );
    expect(keys.get('item1')?.id).toBe('n1');
    expect(JSON.stringify(question)).not.toContain('i1');
  });
});

describe('triageState', () => {
  it('names what it was filed as and where', () => {
    expect(triageState({ body: ' x ', filedAs: 'bug', pagePath: '/learn' })).toEqual({
      new_note: 'x',
      filed_as: 'a bug',
      written_on_page: '/learn',
    });
    expect(triageState({ body: 'y', filedAs: 'idea', pagePath: null })).toEqual({
      new_note: 'y',
      filed_as: 'an idea',
    });
  });

  it('does not tell Jev a kind for a note filed from the one tab', () => {
    expect(triageState({ body: 'z', filedAs: 'note', pagePath: null }).filed_as).toBe(
      'a note; the person did not say whether it is a bug or a request',
    );
  });
});

describe('readTriage', () => {
  const { keys } = duplicateQuestion(CANDIDATES);
  const at = new Date('2026-09-29T12:00:00Z');

  it('reads the four answers into what is stored', () => {
    const triage = readTriage(
      {
        kind: choice('feature', 1),
        module: choice('news', 0.88),
        priority: choice('someday', 0.4),
        route: choice('plan', 0.9),
        duplicate: choice('item2', 0.97),
      },
      keys,
      at,
    );
    expect(triage).toEqual({
      at: '2026-09-29T12:00:00.000Z',
      kind: { value: 'feature', confidence: 1 },
      module: { value: 'news', confidence: 0.88 },
      priority: { value: 3, confidence: 0.4 },
      route: { value: 'plan', confidence: 0.9 },
      duplicate: {
        value: {
          table: 'ideas',
          id: 'i1',
          line: 'Email the morning brief as well as sending it to the phone',
        },
        confidence: 0.97,
      },
    });
  });

  it('keeps a confident none as no match, and a failed answer as null', () => {
    const triage = readTriage(
      {
        kind: { ok: false, reason: 'malformed', detail: 'x' },
        module: choice('app', 0.9),
        priority: choice('next', 0.95),
        duplicate: choice(NO_MATCH, 0.92),
      },
      keys,
      at,
    );
    expect(triage.kind).toBeNull();
    expect(triage.module?.value).toBe('app');
    expect(triage.priority?.value).toBe(1);
    expect(triage.duplicate).toEqual({ value: null, confidence: 0.92 });
  });
});

describe('triageFrom', () => {
  it('reads back what readTriage stored', () => {
    const { keys } = duplicateQuestion(CANDIDATES);
    const stored = readTriage(
      { kind: choice('bug', 1), module: choice('dev', 0.85), duplicate: choice('item1', 0.9) },
      keys,
    );
    expect(triageFrom(JSON.parse(JSON.stringify(stored)))).toEqual(stored);
  });

  it('refuses what is not a triage', () => {
    expect(triageFrom(null)).toBeNull();
    expect(triageFrom({ kind: 'bug' })).toBeNull();
    expect(
      triageFrom({ at: 'x', kind: { value: 'like', confidence: 1 }, module: null }),
    ).toMatchObject({ kind: null, module: null });
  });
});

describe('triageView', () => {
  it('marks what Jev was unsure of and names a sure match', () => {
    const view = triageView({
      at: 'x',
      kind: { value: 'bug', confidence: 1 },
      module: { value: 'learn', confidence: 0.6 },
      priority: { value: 1, confidence: 0.97 },
      route: { value: 'fix', confidence: 0.6 },
      duplicate: { value: { table: 'ideas', id: 'i1', line: 'Same' }, confidence: 0.95 },
    });
    expect(view).toEqual({
      parts: ['Bug', 'Learn?', 'Priority: Next', 'Fix?'],
      match: { table: 'ideas', id: 'i1', line: 'Same' },
      maybeMatch: null,
    });
  });

  it('shows a match under the floor as a maybe', () => {
    const view = triageView({
      at: 'x',
      kind: null,
      module: { value: 'app', confidence: 0.9 },
      priority: null,
      duplicate: { value: { table: 'feedback_items', id: 'n1', line: 'Near' }, confidence: 0.69 },
    });
    expect(view?.parts).toEqual(['Whole app']);
    expect(view?.match).toBeNull();
    expect(view?.maybeMatch?.id).toBe('n1');
  });

  it('reads a row stored before the route question existed', () => {
    const old = { at: 'x', kind: { value: 'bug', confidence: 1 }, module: null };
    expect(triageFrom(old)?.route).toBeNull();
    expect(triageView(triageFrom(old))?.parts).toEqual(['Bug']);
  });

  it('is nothing when nothing was answered', () => {
    expect(triageView(null)).toBeNull();
    expect(
      triageView({ at: 'x', kind: null, module: null, priority: null, duplicate: null }),
    ).toBeNull();
  });
});

describe('the options', () => {
  it('cover every workspace and the whole app', () => {
    expect(Object.keys(TRIAGE_MODULE_OPTIONS)).toContain('app');
    expect(Object.keys(TRIAGE_MODULE_OPTIONS)).toContain('goals');
  });

  it('link a match to where it lives', () => {
    expect(matchHref({ table: 'ideas', id: 'a', line: '' })).toBe('/dev/ideas#idea-a');
    expect(matchHref({ table: 'feedback_items', id: 'b', line: '' })).toBe('/dev/bugs#note-b');
  });
});
