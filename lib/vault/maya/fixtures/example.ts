import type { MayaMaterial } from '../retrieve';

/**
 * The worked example feature #1282 was shaped around, with the notes'
 * bodies written short for the tests: a note arguing you become yourself by
 * acting, beside an older essay that puts action last, as the expression of a
 * self already found.
 */

export const SUBJECT_ID = 'note-against';
export const ESSAY_ID = 'note-road';
export const INTROSPECTION_ID = 'note-introspection';
export const PASSION_ID = 'note-passion';

export const ESSAY_ACTION = 'act in accordance with the discovered self';
export const PASSION_FAKE = 'forcing myself to move felt fake';

export function exampleMaterial(overrides: Partial<MayaMaterial> = {}): MayaMaterial {
  const note = {
    id: SUBJECT_ID,
    title: 'Against "Finding Yourself"',
    body: 'People spend too long trying to find themselves. You do not find yourself, you become yourself, in action.',
    blobSha: 'sha-against',
  };
  const related = [
    {
      id: ESSAY_ID,
      title: 'Life is a road to the self',
      body: `The road has three parts: growth, a view of the self, and action. We reach the goal when we ${ESSAY_ACTION}.`,
      similarity: 0.67,
    },
    {
      id: INTROSPECTION_ID,
      title: 'On Introspection',
      body: 'Going inward is good, but you have to come out again. Philosophising can be a defence against engaging.',
      similarity: 0.77,
    },
    {
      id: PASSION_ID,
      title: 'Rest in reason, move in Passion',
      body: `Rest in reason is the easy side for me. When I tried, ${PASSION_FAKE} and led to poor results.`,
      similarity: 0.68,
    },
  ];
  const bodies = new Map([note, ...related].map((n) => [n.id, { id: n.id, title: n.title, body: n.body }]));
  return {
    note,
    related,
    positions: [
      {
        id: 'pos-discovered',
        name: 'Action expresses a discovered self',
        statement: 'The self is found first and then expressed in action.',
        stance: 'held',
        via: 'related-note',
        quotes: [{ noteId: ESSAY_ID, noteTitle: 'Life is a road to the self', quote: ESSAY_ACTION }],
      },
      {
        id: 'pos-become',
        name: 'The self is made in action',
        statement: 'You become yourself by acting, not by looking inward.',
        stance: 'held',
        via: 'this-note',
        quotes: [{ noteId: SUBJECT_ID, noteTitle: note.title, quote: 'you become yourself, in action' }],
      },
      {
        id: 'pos-balance',
        name: 'Balance reason and passion',
        statement: 'Thinking and acting have to be kept in balance.',
        stance: 'held',
        via: 'theme',
        quotes: [{ noteId: PASSION_ID, noteTitle: 'Rest in reason, move in Passion', quote: 'Rest in reason is the easy side for me.' }],
      },
    ],
    conflicts: [{ leftId: 'pos-discovered', rightId: 'pos-become', crux: 'Whether the self comes before action.', origin: 'contradicts' }],
    bodies,
    ...overrides,
  };
}
