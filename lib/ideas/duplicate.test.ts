import { describe, expect, it } from 'vitest';
import {
  IDEA_DUPLICATE_MIN,
  findDuplicateIdea,
  ideaFirstLine,
  ideaSimilarity,
  ideaWords,
} from './duplicate';
import { MORNING_REPEATS } from './fixtures/morning-repeats';

/**
 * Both halves of the check matter and they pull against each other: the same
 * suggestion filed twice has to be caught, and a suggestion that is merely
 * about the same page has to get through. The cases below are the line
 * between them.
 */

const FILED = [
  {
    id: '11111111-1111-1111-1111-111111111111',
    body: 'Refuse an idea that is already there.\n\nThe idea command writes without reading what is already filed.',
  },
  {
    id: '22222222-2222-2222-2222-222222222222',
    body: 'Show the elapsed time on a job application row, counted from the day it was sent.',
  },
];

describe('ideaWords', () => {
  it('keeps the words that say which idea it is', () => {
    expect([...ideaWords('Refuse an idea that is already there.')]).toEqual([
      'refuse',
      'idea',
      'already',
    ]);
  });

  it('reads an accent and a hyphen as the letters around them', () => {
    expect([...ideaWords('Café — re-scan')]).toEqual(['cafe', 're', 'scan']);
  });
});

describe('ideaSimilarity', () => {
  it('is 1 for the same body', () => {
    expect(ideaSimilarity(FILED[0].body, FILED[0].body)).toBe(1);
  });

  it('is high for the same suggestion written again', () => {
    const score = ideaSimilarity(
      FILED[0].body,
      'Refuse an idea already filed.\n\nThe idea command writes without reading what is filed already.',
    );
    expect(score).toBeGreaterThan(0.7);
  });

  it('is low for two suggestions about the same page', () => {
    expect(
      ideaSimilarity(
        'Sort the ideas page by when each idea was filed.',
        'Group the ideas page by the workspace each idea is about.',
      ),
    ).toBeLessThan(0.7);
  });

  it('says nothing about two ideas of a few words each', () => {
    expect(ideaSimilarity('Sort the ideas page', 'Group the ideas page')).toBe(0);
    expect(ideaSimilarity('Sort the ideas page', 'Sort the ideas page.')).toBe(1);
  });

  it('is 0 when one side is nothing but stopwords', () => {
    expect(ideaSimilarity('it is what it is', FILED[0].body)).toBe(0);
  });
});

describe('findDuplicateIdea', () => {
  it('names the idea a rewrite matched', () => {
    const match = findDuplicateIdea(
      'Refuse an idea that is already filed.\n\nThe idea command writes without reading what is already there.',
      FILED,
    );
    expect(match?.idea.id).toBe(FILED[0].id);
    expect(match?.score).toBeGreaterThan(0.7);
  });

  it('lets a genuinely new idea through', () => {
    expect(
      findDuplicateIdea('Let a shopping list be shared with somebody who has no account.', FILED),
    ).toBeNull();
  });

  it('takes the closest match rather than the first one over the line', () => {
    const near = { id: 'aaaa', body: 'Refuse an idea that is already there.' };
    const exact = { id: 'bbbb', body: FILED[0].body };
    expect(findDuplicateIdea(FILED[0].body, [near, exact])?.idea.id).toBe('bbbb');
  });

  it('finds nothing when the list is empty', () => {
    expect(findDuplicateIdea(FILED[0].body, [])).toBeNull();
  });
});

describe('findDuplicateIdea on a reworded paragraph (plan #1223)', () => {
  const repeat = (id: string) => {
    const idea = MORNING_REPEATS.find((row) => row.id === id);
    if (!idea) throw new Error(`no repeat ${id}`);
    return idea;
  };

  // The pairs the morning run filed twice between 25 and 29 September, the
  // later one first. Each scores under the whole-body bar, which is why the
  // run filed it again.
  const PAIRS = [
    ['1e5937f9', '00e42a11'],
    ['3a8f1038', '636a8233'],
    ['d6d28a49', '636a8233'],
  ] as const;

  it.each(PAIRS)('refuses %s as a repeat of %s', (later, earlier) => {
    const body = repeat(later).body;
    const filed = repeat(earlier);
    expect(ideaSimilarity(body, filed.body)).toBeLessThan(IDEA_DUPLICATE_MIN);

    const match = findDuplicateIdea(body, [filed]);
    expect(match?.idea.id).toBe(earlier);
    expect(match?.on).toBe('first line');
    expect(match?.score).toBeGreaterThanOrEqual(0.8);
  });

  it('files each of the seven once when they arrive in order', () => {
    const filed: { id: string; body: string }[] = [];
    const written: string[] = [];
    for (const idea of MORNING_REPEATS) {
      if (findDuplicateIdea(idea.body, filed)) continue;
      filed.push(idea);
      written.push(idea.id);
    }
    expect(written).toEqual(['b26258a6', '00e42a11', '636a8233', 'd14f85e8']);
  });

  it('lets two short, different headlines through', () => {
    expect(
      findDuplicateIdea('Sort the ideas page\n\nNewest first, so the morning run is on top.', [
        { id: 'aaaa', body: 'Group the ideas page\n\nOne heading per workspace, in the sidebar order.' },
      ]),
    ).toBeNull();
  });

  it('says the whole body matched when it did', () => {
    expect(findDuplicateIdea(FILED[0].body, FILED)?.on).toBe('body');
  });
});

describe('ideaFirstLine', () => {
  it('takes the first line', () => {
    expect(ideaFirstLine(FILED[0].body)).toBe('Refuse an idea that is already there.');
  });

  it('cuts a long line so a refusal fits on one', () => {
    expect(ideaFirstLine('x'.repeat(200))).toHaveLength(70);
  });
});
