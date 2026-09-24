import { describe, expect, it } from 'vitest';
import { NO_PROGRESS, contextFor } from './depth';
import { describeReturn, readAngle } from './return-angle';

/** The naming call for a Level 3 article coming back (plan #912). */

describe('describing a return', () => {
  it('carries the earlier card titles and only the sections still open', () => {
    const prompt = describeReturn({
      article: 'Tide',
      listSection: 'Physical sciences > Earth science',
      earlier: ['Tide', 'Tide: History'],
      sections: ['Tidal forces', null],
      returns: 1,
      depth: contextFor(NO_PROGRESS, { reason: 'goal', aimId: 'l3', start: 'working' }),
    });
    expect(prompt).toContain('The article: Tide');
    expect(prompt).toContain('time 2 it has come back');
    expect(prompt).toContain('must not repeat them:\n- Tide\n- Tide: History');
    expect(prompt).toContain('Sections you may choose from:\n- Tidal forces\n- (the lead)');
  });
});

describe('reading the reply', () => {
  it('keeps the section and basis, and reads an empty section as the lead', () => {
    expect(readAngle({ section: ' Tidal forces ', basis: 'The mechanism.' })).toMatchObject({
      ok: true,
      section: 'Tidal forces',
    });
    expect(readAngle({ section: '', basis: 'The lead.' })).toMatchObject({ ok: true, section: null });
    expect(readAngle({ section: 'X', basis: ' ' })).toMatchObject({ ok: false });
    expect(readAngle({})).toMatchObject({ ok: false });
  });
});
