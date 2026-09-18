import { describe, expect, it } from 'vitest';
import { answerKind, outcomeRow } from './record';

/**
 * What gets written when you do something with a row on Learn next.
 *
 * The insert itself needs a database and is covered by the isolation suites;
 * what is checked here is the shape that goes in, because the table's check
 * constraints refuse anything else and a row that never lands is a signal
 * quietly not being kept.
 */

const USER = 'user-1';

describe('answerKind', () => {
  it('reads an answer about a settled claim as a re-check', () => {
    expect(answerKind(true)).toBe('recheck');
  });

  it('reads an answer about anything else as a claim you were ready for', () => {
    expect(answerKind(false)).toBe('ready');
  });
});

describe('outcomeRow', () => {
  it('points a claim row at the claim and nothing else', () => {
    expect(outcomeRow(USER, { kind: 'ready', conceptId: 'concept-1', outcome: 'answered' })).toEqual(
      {
        user_id: USER,
        kind: 'ready',
        concept_id: 'concept-1',
        reading_id: null,
        outcome: 'answered',
      },
    );
  });

  it('keeps a re-check apart from a claim you were ready for', () => {
    const row = outcomeRow(USER, {
      kind: 'recheck',
      conceptId: 'concept-1',
      outcome: 'answered',
    });
    expect(row.kind).toBe('recheck');
  });

  it('points a reading row at the reading and nothing else', () => {
    expect(outcomeRow(USER, { kind: 'reading', readingId: 'reading-1', outcome: 'read' })).toEqual({
      user_id: USER,
      kind: 'reading',
      concept_id: null,
      reading_id: 'reading-1',
      outcome: 'read',
    });
  });

  it('takes a Not now on either kind', () => {
    const claim = outcomeRow(USER, { kind: 'ready', conceptId: 'concept-1', outcome: 'not_now' });
    const reading = outcomeRow(USER, {
      kind: 'reading',
      readingId: 'reading-1',
      outcome: 'not_now',
    });

    expect([claim.outcome, claim.concept_id]).toEqual(['not_now', 'concept-1']);
    expect([reading.outcome, reading.reading_id]).toEqual(['not_now', 'reading-1']);
  });
});
