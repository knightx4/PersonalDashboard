import type { MayaMaterial } from '../retrieve';

/**
 * A made-up example in the shape of the one feature #1282 was built around,
 * with the notes' bodies written short for the tests: a note arguing you become yourself by
 * acting, beside an older essay that puts action last, as the expression of a
 * self already found.
 */

export const SUBJECT_ID = 'note-against';
export const ESSAY_ID = 'note-road';
export const INTROSPECTION_ID = 'note-introspection';
export const PASSION_ID = 'note-passion';

export const ESSAY_ACTION = 'act on the self we have already found';
export const PASSION_FAKE = 'pushing myself to start felt forced';

export function exampleMaterial(overrides: Partial<MayaMaterial> = {}): MayaMaterial {
  const note = {
    id: SUBJECT_ID,
    title: 'Made, not found',
    body: 'Waiting to know who you are before you start is a mistake. You do not find yourself, you become yourself, in action.',
    blobSha: 'sha-against',
  };
  const related = [
    {
      id: ESSAY_ID,
      title: 'The self comes first',
      body: `There are three steps: learn, settle on who you are, then act. We get there when we ${ESSAY_ACTION}.`,
      similarity: 0.67,
    },
    {
      id: INTROSPECTION_ID,
      title: 'Looking inward',
      body: 'Thinking about yourself helps, up to a point. Past it, more thinking is a way of not starting.',
      similarity: 0.77,
    },
    {
      id: PASSION_ID,
      title: 'Think slowly, act quickly',
      body: `Thinking it over is the easy side for me. When I tried, ${PASSION_FAKE} and went badly.`,
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
        quotes: [{ noteId: ESSAY_ID, noteTitle: 'The self comes first', quote: ESSAY_ACTION }],
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
        name: 'Balance thinking and acting',
        statement: 'Thinking and acting have to be kept in balance.',
        stance: 'held',
        via: 'theme',
        quotes: [{ noteId: PASSION_ID, noteTitle: 'Think slowly, act quickly', quote: 'Thinking it over is the easy side for me.' }],
      },
    ],
    conflicts: [{ leftId: 'pos-discovered', rightId: 'pos-become', crux: 'Whether the self comes before action.', origin: 'contradicts' }],
    bodies,
    ...overrides,
  };
}
