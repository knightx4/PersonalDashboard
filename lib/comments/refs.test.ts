import { describe, expect, it } from 'vitest';
import { planRefHref, planRowId, splitOnRefs } from './refs';

/** The refs found in a body, in order. */
function refs(text: string): number[] {
  return splitOnRefs(text)
    .map((part) => part.ref)
    .filter((ref): ref is number => ref !== null);
}

describe('splitOnRefs', () => {
  it('returns one part for a body with no reference in it', () => {
    expect(splitOnRefs('nothing to see')).toEqual([{ text: 'nothing to see', ref: null }]);
  });

  it('returns one part for the empty string rather than nothing', () => {
    expect(splitOnRefs('')).toEqual([{ text: '', ref: null }]);
  });

  it('finds every number in the sentence the note was filed about', () => {
    expect(
      refs(
        'Its only open steps are #499, which is blocked on a GitHub token, and ' +
          '#500, #501 and #505, which all wait on #499.',
      ),
    ).toEqual([499, 500, 501, 505, 499]);
  });

  it('keeps the words around a reference, and the reference whole', () => {
    expect(splitOnRefs('see #494 next')).toEqual([
      { text: 'see ', ref: null },
      { text: '#494', ref: 494 },
      { text: ' next', ref: null },
    ]);
  });

  it('reads one at the very start of the body', () => {
    expect(splitOnRefs('#494 was fired at three times')[0]).toEqual({ text: '#494', ref: 494 });
  });

  it('reads one against every punctuation mark that ends a clause', () => {
    expect(refs('(#494), [#495]; "#496" -- #497.')).toEqual([494, 495, 496, 497]);
  });

  // The four exclusions. Each one fired somewhere real before it was excluded.
  it('leaves an HTML entity alone', () => {
    expect(refs('it&#39;s fine')).toEqual([]);
  });

  it('leaves a doubled hash alone', () => {
    expect(refs('##494 is not a step')).toEqual([]);
  });

  it('leaves a word that merely starts with digits alone', () => {
    expect(refs('#494a and #12px')).toEqual([]);
  });

  it('leaves a number too long to be a step number alone', () => {
    expect(refs('commit #1234567')).toEqual([]);
    expect(refs('#99999')).toEqual([99999]);
  });

  it('does not read a number that is not preceded by a hash', () => {
    expect(refs('494 steps')).toEqual([]);
  });

  it('reads two references with nothing but a space between them', () => {
    expect(refs('#1 #2')).toEqual([1, 2]);
  });
});

describe('planRefHref', () => {
  // `all`, not the default view: a link has to reach a step that is finished,
  // dropped or filed away, and the open view by definition does not hold those.
  it('points at the widest view, anchored on the row', () => {
    expect(planRefHref(494)).toBe('/dev/plan?view=all#plan-494');
  });

  it('agrees with the id the row carries', () => {
    expect(planRefHref(494).endsWith(`#${planRowId(494)}`)).toBe(true);
  });
});
