import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { answerKind, outcomeRow, recordOutcome } from './record';

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

/**
 * What the write does with a failure.
 *
 * Three cases and three different answers, which is the whole of the logic
 * around the insert: a reading finished twice is one fact, a database a
 * migration behind is not this write's fault, and anything else is a record
 * quietly stopping.
 */
function clientReturning(error: { code: string; message: string } | null): LearnSupabaseClient {
  return {
    from: () => ({ insert: async () => ({ error }) }),
  } as unknown as LearnSupabaseClient;
}

const READING_READ = {
  kind: 'reading',
  readingId: 'reading-1',
  outcome: 'read',
} as const;

describe('recordOutcome', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes without complaint', async () => {
    await expect(recordOutcome(clientReturning(null), USER, READING_READ)).resolves.toBeUndefined();
  });

  it('drops a second finish of the same reading', async () => {
    const twice = clientReturning({ code: '23505', message: 'duplicate key' });
    await expect(recordOutcome(twice, USER, READING_READ)).resolves.toBeUndefined();
  });

  it('carries on when the table is not there yet, saying which migration to run', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const missing = clientReturning({
      code: 'PGRST205',
      message: "Could not find the table 'learn.next_outcomes' in the schema cache",
    });

    // The reading was already marked read by the caller. Throwing here would
    // report a failure over work that happened.
    await expect(recordOutcome(missing, USER, READING_READ)).resolves.toBeUndefined();
    expect(logged.mock.calls[0]?.[0]).toContain('0017_next_outcomes.sql');
  });

  it('throws on anything else, because a record that stops being kept is a bug', async () => {
    const denied = clientReturning({ code: '42501', message: 'permission denied' });
    await expect(recordOutcome(denied, USER, READING_READ)).rejects.toThrow(
      /Recording what you did failed/,
    );
  });
});
