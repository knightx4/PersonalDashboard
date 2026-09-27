import { describe, expect, it } from 'vitest';
import { suggestionsPayload } from './notify';

describe('suggestionsPayload', () => {
  it('sends nothing for a run that wrote nothing', () => {
    expect(suggestionsPayload({ people: [], roles: [] }, '2026-09-27')).toBeNull();
  });

  it('names the first person and counts the rest and the roles', () => {
    expect(
      suggestionsPayload({ people: ['Ask Priya for a referral at Acme', 'Find the lead at Globex'], roles: ['A', 'B'] }, '2026-09-27'),
    ).toEqual({
      title: 'Dash suggests',
      body: 'Ask Priya for a referral at Acme, and 1 more to contact. 2 open roles that fit what you want.',
      url: '/jobs/today',
      tag: 'job-suggestions-2026-09-27',
    });
  });

  it('names a single role', () => {
    expect(suggestionsPayload({ people: [], roles: ['Analyst at Initech'] }, 'd')?.body).toBe(
      'One open role that fits: Analyst at Initech.',
    );
  });
});
