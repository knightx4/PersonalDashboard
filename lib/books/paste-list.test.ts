import { describe, expect, it } from 'vitest';
import { heuristicParseLines } from './paste-list-heuristic';

describe('paste list heuristic', () => {
  it('parses title by author and ISBN lines', () => {
    const rows = heuristicParseLines(
      'Atomic Habits by James Clear\n9780735211292\nDune — Frank Herbert',
    );
    expect(rows).toHaveLength(3);
    expect(rows[0]?.input).toMatchObject({ title: 'Atomic Habits', author: 'James Clear' });
    expect(rows[1]?.input).toMatchObject({ isbn: '9780735211292' });
    expect(rows[2]?.input).toMatchObject({ title: 'Dune', author: 'Frank Herbert' });
  });
});
