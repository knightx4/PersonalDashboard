import { describe, expect, it } from 'vitest';
import { CLIPPING_WEIGHT } from './notes';
import { EVIDENCE_KINDS, KIND_CEILING, evidenceKind, kindAndCeiling, linkCeiling } from './kinds';

describe('evidence kinds', () => {
  it('ranks the kinds by their ceilings', () => {
    expect(EVIDENCE_KINDS.map((k) => KIND_CEILING[k])).toEqual([1, 1, 0.75, 0.5, 0.25, 0.25, 0]);
  });

  it('reads the kind the way the generated column does', () => {
    expect(evidenceKind({ source_kind: 'work', weight: 0.4 })).toBe('work');
    expect(evidenceKind({ source_kind: 'course', weight: 0.6 })).toBe('course');
    expect(evidenceKind({ source_kind: 'note', weight: 1 })).toBe('note');
    expect(evidenceKind({ source_kind: 'note', weight: CLIPPING_WEIGHT })).toBe('clipping');
    expect(evidenceKind({ source_kind: 'reading', weight: 1 })).toBe('clipping');
    expect(evidenceKind({ source_kind: 'video', weight: 1 })).toBe('video');
    expect(evidenceKind({ source_kind: 'idea', weight: 1 })).toBe('mention');
    expect(evidenceKind({ source_kind: 'note', weight: 1, held_reason: 'not about it' })).toBe('mention');
  });

  it('keeps the smaller of the weight and the kind ceiling', () => {
    expect(linkCeiling('note', 1)).toBe(0.5);
    expect(linkCeiling('work', 0.4)).toBe(0.4);
    expect(linkCeiling('course', 0.92)).toBe(0.92);
    expect(linkCeiling('mention', 1)).toBe(0);
    expect(kindAndCeiling({ source_kind: 'note', weight: 0.25 })).toEqual({ kind: 'clipping', ceiling: 0.25 });
  });
});
