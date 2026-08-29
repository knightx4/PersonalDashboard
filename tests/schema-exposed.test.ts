/**
 * A missing Exposed-schemas entry must say so.
 *
 * Three schemas back this app and only `public` is exposed by default. When
 * `job_search` or `core` is missing from that dashboard list, every query
 * against it fails with PGRST106 — and because callers routinely ignore the
 * error object, a count read as zero and a profile read as absent. The app then
 * behaved as though the account had no mailbox and had never onboarded, which
 * presented as an onboarding screen looping back to itself with nothing in the
 * logs naming the cause. That is the failure these assertions exist to prevent
 * from ever being silent again.
 */
import { describe, expect, it } from 'vitest';
import { assertSchemaExposed, SchemaNotExposedError } from '@/lib/core/db/schema-errors';

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
