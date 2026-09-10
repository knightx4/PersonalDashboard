import { describe, expect, it } from 'vitest';
import { writeError } from '@/lib/use-optimistic-write';

describe('writeError', () => {
  it('reads the message an action refused with', () => {
    expect(writeError({ error: 'Ghosted cannot be set by hand.' })).toBe(
      'Ghosted cannot be set by hand.',
    );
  });

  it('is null for a write that worked', () => {
    expect(writeError({ error: null })).toBeNull();
    expect(writeError({})).toBeNull();
    expect(writeError(undefined)).toBeNull();
  });

  // A form-state action returns { message } on success, and the hook must not
  // read that as a failure.
  it('ignores everything but the error', () => {
    expect(writeError({ message: 'Saved.' })).toBeNull();
  });

  // An action that returns { error: '' } has said nothing, and an empty toast
  // is worse than none: the control reverting is then the whole report.
  it('treats a blank error as no error', () => {
    expect(writeError({ error: '   ' })).toBeNull();
  });

  it('is null for anything that is not an object', () => {
    expect(writeError('error')).toBeNull();
    expect(writeError(null)).toBeNull();
  });
});
