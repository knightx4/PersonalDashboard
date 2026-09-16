/**
 * A missing Exposed-schemas entry must say so.
 *
 * Five schemas back this app and only `public` is exposed by default. When
 * `job_search` or `core` is missing from that dashboard list, every query
 * against it fails with PGRST106 — and because callers routinely ignore the
 * error object, a count read as zero and a profile read as absent. The app then
 * behaved as though the account had no mailbox and had never onboarded, which
 * presented as an onboarding screen looping back to itself with nothing in the
 * logs naming the cause. That is the failure these assertions exist to prevent
 * from ever being silent again.
 */
import { describe, expect, it } from 'vitest';
import {
  assertSchemaExposed,
  isMissingTable,
  SchemaNotExposedError,
} from '@/lib/core/db/schema-errors';

describe('assertSchemaExposed', () => {
  it('throws on PGRST106, naming the schema and the fix', () => {
    let caught: unknown;
    try {
      assertSchemaExposed({ code: 'PGRST106', message: 'Invalid schema: core' }, 'core');
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(SchemaNotExposedError);
    const message = (caught as Error).message;
    expect(message).toContain('core');
    // The fix is a dashboard setting, so the message has to say where.
    expect(message).toContain('Exposed schemas');
    expect(message).toContain('job_search');
    // Every schema the app needs, so adding one and forgetting the dashboard
    // produces a message that still names it.
    expect(message).toContain('obsidian');
    expect(message).toContain('todo');
  });

  it('ignores every other error, which callers still handle themselves', () => {
    expect(() =>
      assertSchemaExposed({ code: 'PGRST116', message: 'no rows' }, 'core'),
    ).not.toThrow();
    expect(() => assertSchemaExposed({ code: '42501', message: 'denied' }, 'core')).not.toThrow();
  });

  it('does nothing when the query succeeded', () => {
    expect(() => assertSchemaExposed(null, 'core')).not.toThrow();
    expect(() => assertSchemaExposed(undefined as never, 'core')).not.toThrow();
  });
});

/**
 * A table that is not there yet is a different fault with a different fix.
 *
 * The schema is served, the migration was never applied -- code deploys on
 * merge and migrations do not. A caller that can carry on without the table
 * needs to tell that failure apart from a permission error or a bad column,
 * because swallowing either of those is how a real bug goes quiet.
 */
describe('isMissingTable', () => {
  it('recognises PostgREST and Postgres saying the table does not exist', () => {
    expect(
      isMissingTable({
        code: 'PGRST205',
        message: "Could not find the table 'learn.next_outcomes' in the schema cache",
      }),
    ).toBe(true);
    expect(
      isMissingTable({ code: '42P01', message: 'relation "learn.next_outcomes" does not exist' }),
    ).toBe(true);
  });

  it('is false for every other failure, and for none', () => {
    expect(isMissingTable({ code: 'PGRST106', message: 'Invalid schema: learn' })).toBe(false);
    expect(isMissingTable({ code: '42501', message: 'permission denied' })).toBe(false);
    expect(isMissingTable({ code: '42703', message: 'column does not exist' })).toBe(false);
    expect(isMissingTable(null)).toBe(false);
  });
});
