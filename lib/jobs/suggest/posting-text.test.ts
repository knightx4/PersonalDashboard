import { describe, expect, it } from 'vitest';
import { postingLooksClosed } from './posting-text';

describe('postingLooksClosed', () => {
  it('reads a closed notice at the top of the page', () => {
    expect(postingLooksClosed('Acme careers\nThis job is no longer available.\nSee other roles')).toBe(true);
    expect(postingLooksClosed('Sorry, we are no longer accepting applications for this position.')).toBe(true);
    expect(postingLooksClosed('The position has been filled.')).toBe(true);
  });

  it('leaves an open posting, and a notice far down the page, alone', () => {
    expect(postingLooksClosed('Senior Analyst\nWe are hiring a senior analyst to own the forecast.')).toBe(false);
    expect(postingLooksClosed(`${'About the role. '.repeat(200)} This job is no longer available.`)).toBe(false);
  });
});
