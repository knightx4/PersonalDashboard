/**
 * The coverage number.
 *
 * Small arithmetic, but it is about to appear on the role header, on every
 * pipeline row and behind a rail filter, and the whole point of it is that you
 * act on it — so the denominator rules are asserted here rather than trusted
 * to three call sites reading the same map.
 */
import { describe, expect, it } from 'vitest';
import { formatCoverage, requirementCoverage, type CoverageEntry } from '@/lib/jobs/pipeline';

const must = (verdict: CoverageEntry['verdict']): CoverageEntry => ({ kind: 'must_have', verdict });
const nice = (verdict: CoverageEntry['verdict']): CoverageEntry => ({
  kind: 'nice_to_have',
  verdict,
});

describe('requirementCoverage', () => {
  it('counts the strong must-haves', () => {
    const coverage = requirementCoverage([must('strong'), must('strong'), must('gap')]);
    expect(coverage.covered).toBe(2);
    expect(coverage.total).toBe(3);
    expect(coverage.gaps).toBe(1);
  });

  it('ignores nice-to-haves and responsibilities entirely', () => {
    const coverage = requirementCoverage([
      must('strong'),
      nice('gap'),
      nice('gap'),
      { kind: 'responsibility', verdict: 'gap' },
    ]);
    expect(coverage.covered).toBe(1);
    expect(coverage.total).toBe(1);
    expect(coverage.gaps).toBe(0);
  });

  it('scores a partial as half, between a hollow map and a strong one', () => {
    const hollow = requirementCoverage([must('gap'), must('gap')]);
    const mixed = requirementCoverage([must('partial'), must('partial')]);
    const solid = requirementCoverage([must('strong'), must('strong')]);
    expect(hollow.rate).toBe(0);
    expect(mixed.rate).toBe(0.5);
    expect(solid.rate).toBe(1);
  });

  it('does not let a partial inflate the covered count', () => {
    expect(requirementCoverage([must('partial'), must('partial')]).covered).toBe(0);
  });

  it('gives a null rate rather than zero when there are no must-haves', () => {
    expect(requirementCoverage([nice('strong')]).rate).toBeNull();
    expect(requirementCoverage([]).rate).toBeNull();
    expect(requirementCoverage(null).rate).toBeNull();
    expect(requirementCoverage(undefined).total).toBe(0);
  });
});

describe('formatCoverage', () => {
  it('reads as a count, not a percentage', () => {
    expect(formatCoverage(requirementCoverage([must('strong'), must('gap')]))).toBe(
      '1 of 2 must-haves',
    );
  });

  it('does not say "1 must-haves"', () => {
    expect(formatCoverage(requirementCoverage([must('strong')]))).toBe('1 of 1 must-have');
  });

  it('says nothing when there is nothing to say', () => {
    expect(formatCoverage(requirementCoverage([]))).toBeNull();
  });
});
